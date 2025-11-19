// routes/projectBulkUpload.js
//check for the duplicacy and also the error that may cause error
const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const { Parser } = require("json2csv");
const mongoose = require("mongoose");

const Project = require("../models/Project");
const Subproject = require("../models/Subproject");

const upload = multer({ dest: "uploads/" });

// Escape regex helper
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalize name to prevent duplicates
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ") // convert hyphens/underscores to spaces
    .replace(/\s+/g, " ")   // collapse multiple spaces
    .trim();
}

router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    // Read CSV data
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (row) => {
          // Skip empty rows
          if (
            Object.values(row).every(
              (v) => v === "" || v === null || v === undefined
            )
          )
            return;
          rows.push(row);
        })
        .on("end", resolve)
        .on("error", reject);
    });

    const norm = (s) => (typeof s === "string" ? s.trim() : "");
    const errors = [];

    // Normalize input rows
    const normalized = rows.map((r, idx) => {
      const project_name = norm(r.project_name);
      const project_description = norm(r.project_description);

      const visibility = norm(r.visibility || "visible");
      const status = norm(r.status || "active");

      const rawFlat = r.flatrate !== undefined ? String(r.flatrate).trim() : "";
      const flatrate = rawFlat === "" ? 0 : parseFloat(rawFlat);

      const subproject_name = norm(r.subproject_name);
      const subproject_description = norm(r.subproject_description);
      const subproject_status = norm(r.subproject_status || "active");

      const rowOut = {
        __row: idx + 1,
        project_name,
        project_description,
        visibility,
        status,
        flatrate,
        subproject_name,
        subproject_description,
        subproject_status,
      };

      // Basic validation
      const rowErrors = [];
      if (!project_name) rowErrors.push("project_name required");
      if (!subproject_name) rowErrors.push("subproject_name required");

      if (!["visible", "hidden"].includes(visibility))
        rowErrors.push("visibility must be visible|hidden");

      if (!["active", "inactive"].includes(status))
        rowErrors.push("status must be active|inactive");

      if (!Number.isFinite(flatrate))
        rowErrors.push("flatrate must be numeric");

      if (rowErrors.length)
        errors.push({ ...rowOut, errors: rowErrors.join("; ") });

      return rowOut;
    });

    if (normalized.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "CSV contains no rows" });
    }

    // ---------------------------------------------
    // 🔥 DUPLICATE CHECK (Project + Subproject)
    // ---------------------------------------------

   // ---------------------------------------------
// 🔥 CHECK ONLY DUPLICATE SUBPROJECTS
// ---------------------------------------------

const normalizedProjectNames = [
  ...new Set(normalized.map((r) => normalizeName(r.project_name))),
];

// Fetch existing projects (needed to check subprojects)
const existingProjects = await Project.find({
  name: {
    $in: normalizedProjectNames.map(
      (n) => new RegExp(`^${escapeRegex(n)}$`, "i")
    ),
  },
});

// Build map of existing projects
const existingProjectMap = new Map();
existingProjects.forEach((p) => {
  existingProjectMap.set(normalizeName(p.name), p);
});

// Check for subproject duplicates
for (const r of normalized) {
  const projectKey = normalizeName(r.project_name);
  const projectDoc = existingProjectMap.get(projectKey);

  if (projectDoc) {
    // Check if subproject already exists under that project
    const existingSub = await Subproject.findOne({
      name: r.subproject_name,
      project_id: projectDoc._id,
    });

    if (existingSub) {
      errors.push({
        ...r,
        errors: "subproject already exists under this project",
      });
    }
  }
}

    // ❌ If ANY error → return CSV file
    if (errors.length > 0) {
      const fields = [
        "__row",
        "project_name",
        "subproject_name",
        "errors",
      ];
      const parser = new Parser({ fields });
      const csvOut = parser.parse(errors);

      fs.unlinkSync(filePath);
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=bulk-upload-errors.csv"
      );
      res.setHeader("Content-Type", "text/csv");

      return res.status(400).send(csvOut);
    }

    // ---------------------------------------------
    // ✅ IF NO ERRORS → Write to DB
    // ---------------------------------------------
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const projectCache = new Map();

      existingProjects.forEach((p) =>
        projectCache.set(normalizeName(p.name), p)
      );

      for (const r of normalized) {
        const key = normalizeName(r.project_name);
        let projectDoc = projectCache.get(key);

        if (!projectDoc) {
          const created = await Project.create(
            [
              {
                name: r.project_name,
                description: r.project_description || "",
                visibility: r.visibility,
                status: r.status,
              },
            ],
            { session }
          );

          projectDoc = created[0];
          projectCache.set(key, projectDoc);
        }

        await Subproject.create(
          [
            {
              name: r.subproject_name,
              description: r.subproject_description || "",
              status: r.subproject_status,
              project_id: projectDoc._id,
              flatrate: r.flatrate,
            },
          ],
          { session }
        );
      }

      await session.commitTransaction();
      session.endSession();
      fs.unlinkSync(filePath);

      return res.json({
        status: "success",
        message: "Bulk upload completed successfully",
        totalRows: normalized.length,
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      fs.unlinkSync(filePath);

      return res
        .status(500)
        .json({ error: "Database update failed. Transaction aborted." });
    }
  } catch (err) {
    console.error("Bulk upload error:", err);
    try {
      fs.unlinkSync(filePath);
    } catch {}
    return res.status(500).json({ error: "Failed to process CSV" });
  }
});

module.exports = router;
