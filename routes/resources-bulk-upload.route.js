// routes/resourceBulkUpload.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const mongoose = require("mongoose");
const { Parser } = require("json2csv");

const Resource = require("../models/Resource");
const Project = require("../models/Project");
const Subproject = require("../models/Subproject");
const Billing = require("../models/Billing");
const SubprojectProductivity = require("../models/SubprojectProductivity");

const upload = multer({ dest: "uploads/" });

// normalize helper
const norm = (s) => (typeof s === "string" ? s.trim() : "");

router.post("/bul", upload.single("file"), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: "CSV file is required" });

  const filePath = req.file.path;
  const rows = [];
  const errors = [];

  try {
    // ----------------------------------------
    //  READ CSV
    // ----------------------------------------
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (row) => {
          if (Object.values(row).every((v) => !v)) return;
          rows.push(row);
        })
        .on("end", resolve)
        .on("error", reject);
    });

    if (rows.length === 0)
      return res.status(400).json({ error: "CSV is empty" });

    // ----------------------------------------
    //  EXPECTED CSV COLUMNS
    // ----------------------------------------
    // name,email,role,projects,subprojects
    // projects => comma-separated project names
    // subprojects => comma-separated subproject names
    // ----------------------------------------

    const parsed = rows.map((r, i) => {
      const row = {
        __row: i + 1,
        name: norm(r.name),
        role: norm(r.role),
        email: norm(r.email),
        projects_raw: norm(r.projects || ""),         // names
        subprojects_raw: norm(r.subprojects || ""),   // names
      };

      const rowErrors = [];

      if (!row.name) rowErrors.push("name required");
      if (!row.email) rowErrors.push("email required");
      if (!row.role) rowErrors.push("role required");

      if (rowErrors.length) {
        errors.push({ ...row, errors: rowErrors.join("; ") });
      }

      return row;
    });

    // if validation errors → return CSV file
    if (errors.length > 0) {
      const parser = new Parser({
        fields: ["__row", "email", "name", "errors"],
      });
      const csvOut = parser.parse(errors);

      fs.unlinkSync(filePath);
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=resource-upload-errors.csv"
      );
      res.setHeader("Content-Type", "text/csv");
      return res.status(400).send(csvOut);
    }

    // --------------------------------------------
    //  PRELOAD ALL PROJECTS & SUBPROJECTS
    // --------------------------------------------
    const allProjects = await Project.find({});
    const projectMap = new Map(
      allProjects.map((p) => [p.name.trim().toLowerCase(), p])
    );

    const allSubprojects = await Subproject.find({});
    const subprojectMap = new Map(
      allSubprojects.map((s) => [s.name.trim().toLowerCase(), s])
    );

    // --------------------------------------------
    //  DUPLICATE EMAIL CHECK
    // --------------------------------------------
    // for (const r of parsed) {
    //   const exists = await Resource.findOne({ email: r.email });
    //   if (exists) {
    //     errors.push({ ...r, errors: "email already exists" });
    //   }
    // }

    if (errors.length > 0) {
      const parser = new Parser({
        fields: ["__row", "email", "name", "errors"],
      });
      const csvOut = parser.parse(errors);

      fs.unlinkSync(filePath);
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=resource-upload-errors.csv"
      );
      res.setHeader("Content-Type", "text/csv");
      return res.status(400).send(csvOut);
    }

    // --------------------------------------------
    //  BEGIN TRANSACTION
    // --------------------------------------------
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      for (const r of parsed) {
        const projectNames = r.projects_raw
          ? r.projects_raw.split(",").map((p) => p.trim().toLowerCase())
          : [];

        const subprojectNames = r.subprojects_raw
          ? r.subprojects_raw.split(",").map((s) => s.trim().toLowerCase())
          : [];

        const assigned_projects = [];
        const assigned_subprojects = [];

        // -------------------------------
        // MATCH PROJECTS
        // -------------------------------
        for (const p of projectNames) {
          if (projectMap.has(p)) assigned_projects.push(projectMap.get(p)._id);
          else {
            errors.push({
              __row: r.__row,
              email: r.email,
              errors: `project not found: ${p}`,
            });
          }
        }

        // -------------------------------
        // MATCH SUBPROJECTS
        // -------------------------------
        for (const s of subprojectNames) {
          if (subprojectMap.has(s))
            assigned_subprojects.push(subprojectMap.get(s)._id);
          else {
            errors.push({
              __row: r.__row,
              email: r.email,
              errors: `subproject not found: ${s}`,
            });
          }
        }
      }

      // return errors if any
      if (errors.length > 0) {
        const parser = new Parser({
          fields: ["__row", "email", "errors"],
        });
        const csvOut = parser.parse(errors);

        await session.abortTransaction();
        session.endSession();
        fs.unlinkSync(filePath);

        res.setHeader(
          "Content-Disposition",
          "attachment; filename=resource-upload-errors.csv"
        );
        res.setHeader("Content-Type", "text/csv");
        return res.status(400).send(csvOut);
      }

      // --------------------------------------------
      //  FINAL INSERT + BILLING GENERATION
      // --------------------------------------------
      for (const r of parsed) {
        const projectIds = r.projects_raw
          ? r.projects_raw.split(",").map((p) => projectMap.get(p.trim().toLowerCase())._id)
          : [];

        const subprojectIds = r.subprojects_raw
          ? r.subprojects_raw.split(",").map((s) => subprojectMap.get(s.trim().toLowerCase())._id)
          : [];

        // // Create resource
        // const createdResource = await Resource.create(
        //   [
        //     {
        //       name: r.name,
        //       role: r.role,
        //       email: r.email,
        //       avatar_url:"https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST",
        //       assigned_projects: projectIds,
        //       assigned_subprojects: subprojectIds,
        //     },
        //   ],
        //   { session }
        // );
       //  const resource = createdResource[0];

// --------------------------------------------
//  CREATE OR UPDATE RESOURCE (MERGE MODE)
// --------------------------------------------
for (const r of parsed) {

  // compute projectIds & subprojectIds

  // -------------------------------
  // Find or Create Resource
  // -------------------------------
  let resource = await Resource.findOne({ email: r.email }).session(session);
const DEFAULT_AVATAR = "https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST0"
 console.log(DEFAULT_AVATAR)
  if (!resource) {
    const created = await Resource.create(
      [{
        name: r.name,
        role: r.role,
        email: r.email,
        avatar_url: DEFAULT_AVATAR,
        assigned_projects: projectIds,
        assigned_subprojects: subprojectIds,
      }],
      { session }
    );
    resource = created[0];

  } else {
    // Merge assignments
    resource.assigned_projects = Array.from(new Set([
      ...resource.assigned_projects.map(id => id.toString()),
      ...projectIds.map(id => id.toString()),
    ]));

    resource.assigned_subprojects = Array.from(new Set([
      ...resource.assigned_subprojects.map(id => id.toString()),
      ...subprojectIds.map(id => id.toString()),
    ]));

    await resource.save({ session });
  }

  // -------------------------------
  // Billing entries — MUST be inside this loop
  // because resource must be in scope here
  // -------------------------------
  for (const pid of projectIds) {
    for (const sid of subprojectIds) {
      const alreadyExists = await Billing.findOne({
        project_id: pid,
        subproject_id: sid,
        resource_id: resource._id,   // works now
      }).session(session);

      if (!alreadyExists) {
        await Billing.create(
          [{
            project_id: pid,
            subproject_id: sid,
            resource_id: resource._id,
            rate: 0,
            hours: 0,
            total_amount: 0,
            productivity_level: "medium",
            description: `Auto-generated (CSV Import)`,
            month: null,
            year: new Date().getFullYear(),
          }],
          { session }
        );
      }
    }
  }

} // END LOOP


      }

      await session.commitTransaction();
      session.endSession();
      fs.unlinkSync(filePath);

      return res.json({
        status: "success",
        message: "Resource bulk upload completed successfully",
        totalRows: parsed.length,
      });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      fs.unlinkSync(filePath);

      console.error("Bulk Resource Upload Error:", err);
      return res.status(500).json({ error: "Transaction failed" });
    }
  } catch (err) {
    console.error("Master Error:", err);
    try {
      fs.unlinkSync(filePath);
    } catch {}
    res.status(500).json({ error: "File processing failed" });
  }
});

module.exports = router;
