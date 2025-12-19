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

// Batch size for processing (adjust based on Cosmos DB limits)
const BATCH_SIZE = 10;

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
    //  PARSE AND VALIDATE
    // ----------------------------------------
    const parsed = rows.map((r, i) => {
      const row = {
        __row: i + 1,
        name: norm(r.name),
        role: norm(r.role),
        email: norm(r.email),
        projects_raw: norm(r.projects || ""),
        subprojects_raw: norm(r.subprojects || ""),
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
    //  VALIDATE PROJECTS & SUBPROJECTS EXIST
    // --------------------------------------------
    for (const r of parsed) {
      const projectNames = r.projects_raw
        ? r.projects_raw.split(",").map((p) => p.trim().toLowerCase())
        : [];

      const subprojectNames = r.subprojects_raw
        ? r.subprojects_raw.split(",").map((s) => s.trim().toLowerCase())
        : [];

      for (const p of projectNames) {
        if (!projectMap.has(p)) {
          errors.push({
            __row: r.__row,
            email: r.email,
            errors: `project not found: ${p}`,
          });
        }
      }

      for (const s of subprojectNames) {
        if (!subprojectMap.has(s)) {
          errors.push({
            __row: r.__row,
            email: r.email,
            errors: `subproject not found: ${s}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      const parser = new Parser({
        fields: ["__row", "email", "errors"],
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
    //  PROCESS IN BATCHES
    // --------------------------------------------
    const DEFAULT_AVATAR = "https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST0";
    
    let processedCount = 0;
    const failedRecords = [];

    // Split into batches
    for (let i = 0; i < parsed.length; i += BATCH_SIZE) {
      const batch = parsed.slice(i, i + BATCH_SIZE);
      
      const session = await mongoose.startSession();
      session.startTransaction();

      try {
        for (const r of batch) {
          try {
            const projectIds = r.projects_raw
              ? r.projects_raw.split(",").map((p) => projectMap.get(p.trim().toLowerCase())._id)
              : [];

            const subprojectIds = r.subprojects_raw
              ? r.subprojects_raw.split(",").map((s) => subprojectMap.get(s.trim().toLowerCase())._id)
              : [];

            // Find or Create Resource
            let resource = await Resource.findOne({ email: r.email }).session(session);

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

            // Create Billing entries
            for (const pid of projectIds) {
              for (const sid of subprojectIds) {
                const alreadyExists = await Billing.findOne({
                  project_id: pid,
                  subproject_id: sid,
                  resource_id: resource._id,
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

            processedCount++;
          } catch (recordErr) {
            console.error(`Error processing record ${r.__row}:`, recordErr.message);
            failedRecords.push({
              __row: r.__row,
              email: r.email,
              error: recordErr.message
            });
            throw recordErr; // Abort this batch
          }
        }

        await session.commitTransaction();
        session.endSession();
        
        console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} completed: ${batch.length} resources`);
      } catch (err) {
        await session.abortTransaction();
        session.endSession();
        console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, err.message);
        
        // If batch fails, record all items in batch as failed
        for (const r of batch) {
          if (!failedRecords.find(f => f.email === r.email)) {
            failedRecords.push({
              __row: r.__row,
              email: r.email,
              error: "Batch transaction failed"
            });
          }
        }
      }
    }

    fs.unlinkSync(filePath);

    // Return results
    if (failedRecords.length > 0) {
      return res.status(207).json({
        status: "partial_success",
        message: `Processed ${processedCount} of ${parsed.length} resources`,
        successful: processedCount,
        failed: failedRecords.length,
        failedRecords: failedRecords,
      });
    }

    return res.json({
      status: "success",
      message: "Resource bulk upload completed successfully",
      totalRows: parsed.length,
      processedRows: processedCount,
    });

  } catch (err) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
    console.error("File processing error:", err.message);
    res.status(500).json({ error: "File processing failed: " + err.message });
  }
});

module.exports = router;