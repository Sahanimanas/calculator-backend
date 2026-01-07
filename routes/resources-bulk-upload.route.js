// routes/resourceUpload.js
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
const SubprojectRequestType = require("../models/SubprojectRequestType");
const Productivity = require("../models/SubprojectProductivity");

const upload = multer({ dest: "uploads/" });

// Helper functions
const norm = (s) => (typeof s === "string" ? s.trim() : "");

// All request types - billing created for each
const ALL_REQUEST_TYPES = ["New Request", "Key", "Duplicate"];

// Batch size for processing
const BATCH_SIZE = 100;

const DEFAULT_AVATAR = "https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST0";

router.post("/bul", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "CSV file is required" });
  }

  const filePath = req.file.path;
  const rows = [];
  const errors = [];

  try {
    // ----------------------------------------
    // 1. READ CSV
    // ----------------------------------------
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on("data", (row) => {
          if (Object.values(row).some((v) => v)) {
            rows.push(row);
          }
        })
        .on("end", resolve)
        .on("error", reject);
    });

    if (rows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "CSV is empty" });
    }

    console.log(`📄 Read ${rows.length} rows from CSV`);

    // ----------------------------------------
    // 2. PARSE AND MAP COLUMNS
    // ----------------------------------------
    const parsed = rows.map((r, i) => {
      const name = norm(r["resource name"] || r["name"]);
      const generatedEmail = name 
        ? `${name.replace(/\s+/g, '.').toLowerCase()}@placeholder.com` 
        : "";

      return {
        __row: i + 1,
        name: name,
        projects_raw: norm(r["process type"] || r["projects"]),
        role: norm(r["role"] || "Employee"),
        email: norm(r["email"] || generatedEmail),
      };
    });

    // ----------------------------------------
    // 3. VALIDATION
    // ----------------------------------------
    const validParsed = [];

    parsed.forEach(row => {
      const rowErrors = [];
      if (!row.name) rowErrors.push("resource name required");
      if (!row.email) rowErrors.push("email required");

      if (rowErrors.length) {
        errors.push({ ...row, errors: rowErrors.join("; ") });
      } else {
        validParsed.push(row);
      }
    });

    if (errors.length > 0) {
      return returnErrorCsv(res, filePath, errors);
    }

    console.log(`✅ Validated ${validParsed.length} rows`);

    // ----------------------------------------
    // 4. PRELOAD DATA & BUILD LOOKUP MAPS
    // ----------------------------------------
    console.log("📊 Loading existing data...");

    const allProjects = await Project.find({}).lean();
    const projectMap = new Map(
      allProjects.map((p) => [p.name.trim().toLowerCase(), p])
    );

    const allSubprojects = await Subproject.find({}).lean();
    
    // Map: ProjectID -> Array of Subprojects
    const subprojectByProjectMap = new Map();
    allSubprojects.forEach(sp => {
      const pId = sp.project_id.toString();
      if (!subprojectByProjectMap.has(pId)) {
        subprojectByProjectMap.set(pId, []);
      }
      subprojectByProjectMap.get(pId).push(sp);
    });

    // Map: SubprojectID -> Array of Request Types
    const allRequestTypes = await SubprojectRequestType.find({}).lean();
    const requestTypeBySubprojectMap = new Map();
    allRequestTypes.forEach(rt => {
      const spId = rt.subproject_id.toString();
      if (!requestTypeBySubprojectMap.has(spId)) {
        requestTypeBySubprojectMap.set(spId, []);
      }
      requestTypeBySubprojectMap.get(spId).push(rt);
    });

    // Map: SubprojectID -> Productivity rates
    const allProductivity = await Productivity.find({}).lean();
    const productivityMap = new Map();
    allProductivity.forEach(p => {
      const spId = p.subproject_id.toString();
      if (!productivityMap.has(spId)) {
        productivityMap.set(spId, []);
      }
      productivityMap.get(spId).push({
        level: p.level.toLowerCase(),
        base_rate: p.base_rate || 0
      });
    });

    console.log(`  📁 Projects: ${allProjects.length}`);
    console.log(`  📂 Subprojects: ${allSubprojects.length}`);
    console.log(`  📋 Request Types: ${allRequestTypes.length}`);

    // ----------------------------------------
    // 5. VALIDATE PROJECT EXISTENCE
    // ----------------------------------------
    for (const r of validParsed) {
      const projectNames = r.projects_raw
        ? r.projects_raw.split(",").map((p) => p.trim().toLowerCase())
        : [];

      for (const p of projectNames) {
        if (p && !projectMap.has(p)) {
          errors.push({
            __row: r.__row,
            name: r.name,
            errors: `Process Type (Project) not found: ${p}`,
          });
        }
      }
    }

    if (errors.length > 0) {
      return returnErrorCsv(res, filePath, errors);
    }

    // ----------------------------------------
    // 6. PROCESS RESOURCES (No Transaction)
    // ----------------------------------------
    console.log("📝 Processing resources...");

    let processedCount = 0;
    let billingCreatedCount = 0;
    const failedRecords = [];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // Helper to get rate for a productivity level
    const getRateForLevel = (subprojectId, level = 'medium') => {
      const rates = productivityMap.get(subprojectId.toString()) || [];
      const found = rates.find(r => r.level === level.toLowerCase());
      return found ? found.base_rate : 0;
    };

    for (let i = 0; i < validParsed.length; i += BATCH_SIZE) {
      const batch = validParsed.slice(i, i + BATCH_SIZE);

      for (const r of batch) {
        try {
          // 1. Get Project IDs
          const projectObjs = r.projects_raw
            ? r.projects_raw.split(",")
                .map((p) => p.trim().toLowerCase())
                .filter(p => p && projectMap.has(p))
                .map((p) => projectMap.get(p))
            : [];

          const projectIds = projectObjs.map(p => p._id);

          // 2. Get all Subprojects for these Projects
          let autoSubprojectIds = [];
          projectIds.forEach(pid => {
            const subs = subprojectByProjectMap.get(pid.toString()) || [];
            subs.forEach(sp => autoSubprojectIds.push(sp._id));
          });

          // 3. Find or Create Resource (using upsert)
          const resource = await Resource.findOneAndUpdate(
            { email: r.email },
            {
              $set: {
                name: r.name,
                role: r.role,
              },
              $setOnInsert: {
                email: r.email,
                avatar_url: DEFAULT_AVATAR,
              },
              $addToSet: {
                assigned_projects: { $each: projectIds },
                assigned_subprojects: { $each: autoSubprojectIds },
              }
            },
            { upsert: true, new: true }
          );

          // 4. Create Billing Records for each Project -> Subproject -> Request Type
          for (const pid of projectIds) {
            const projectObj = projectObjs.find(p => p._id.equals(pid));
            const relevantSubprojects = subprojectByProjectMap.get(pid.toString()) || [];

            for (const sp of relevantSubprojects) {
              // Get request types for this subproject
              const subprojectRequestTypes = requestTypeBySubprojectMap.get(sp._id.toString()) || [];
              
              // If no request types defined, use default ALL_REQUEST_TYPES
              const typesToCreate = subprojectRequestTypes.length > 0
                ? subprojectRequestTypes.map(rt => rt.name)
                : ALL_REQUEST_TYPES;

              // Get medium rate for this subproject
              const mediumRate = getRateForLevel(sp._id, 'medium');

              // Create billing for EACH request type
              for (const reqType of typesToCreate) {
                const filter = {
                  project_id: pid,
                  subproject_id: sp._id,
                  resource_id: resource._id,
                  request_type: reqType,
                  month: currentMonth,
                  year: currentYear
                };

                const updateData = {
                  $setOnInsert: {
                    project_id: pid,
                    subproject_id: sp._id,
                    resource_id: resource._id,
                    request_type: reqType,
                    month: currentMonth,
                    year: currentYear,
                    project_name: projectObj?.name || "Unknown",
                    subproject_name: sp.name || "",
                    resource_name: resource.name,
                    resource_role: resource.role,
                    rate: mediumRate,
                    flatrate: sp.flatrate || 0,
                    hours: 0,
                    costing: 0,
                    total_amount: 0,
                    productivity_level: "Medium",
                    billable_status: "Billable",
                    description: `Auto-generated for ${sp.name} - ${reqType}`
                  }
                };

                await Billing.findOneAndUpdate(filter, updateData, { upsert: true });
                billingCreatedCount++;
              }
            }
          }

          processedCount++;

        } catch (recordErr) {
          console.error(`❌ Error processing row ${r.__row}:`, recordErr.message);
          failedRecords.push({
            __row: r.__row,
            name: r.name,
            error: recordErr.message
          });
        }
      }

      console.log(`  📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Processed ${Math.min(i + BATCH_SIZE, validParsed.length)}/${validParsed.length} resources`);
    }

    // Cleanup
    fs.unlinkSync(filePath);

    console.log(`✅ Completed: ${processedCount} resources, ${billingCreatedCount} billing records`);

    // Response
    if (failedRecords.length > 0) {
      return res.status(207).json({
        status: "partial_success",
        message: `Processed ${processedCount} of ${validParsed.length} resources`,
        summary: {
          successful: processedCount,
          failed: failedRecords.length,
          billingRecordsCreated: billingCreatedCount
        },
        failedRecords: failedRecords,
      });
    }

    return res.json({
      status: "success",
      message: "Bulk upload completed successfully",
      summary: {
        totalRows: validParsed.length,
        resourcesProcessed: processedCount,
        billingRecordsCreated: billingCreatedCount,
        note: "Billing created for each resource-subproject-requestType combination"
      }
    });

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error("❌ File processing error:", err.message);
    res.status(500).json({ error: "File processing failed: " + err.message });
  }
});

// ----------------------------------------
// ALTERNATIVE: Quick Resource Upload (No Billing)
// ----------------------------------------
router.post("/bulk-resources-only", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "CSV file is required" });
  }

  const filePath = req.file.path;
  const rows = [];

  try {
    // Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv({ mapHeaders: ({ header }) => header.trim().toLowerCase() }))
        .on("data", (row) => {
          if (Object.values(row).some((v) => v)) {
            rows.push(row);
          }
        })
        .on("end", resolve)
        .on("error", reject);
    });

    console.log(`📄 Read ${rows.length} rows`);

    // Load projects and subprojects
    const allProjects = await Project.find({}).lean();
    const projectMap = new Map(
      allProjects.map((p) => [p.name.trim().toLowerCase(), p])
    );

    const allSubprojects = await Subproject.find({}).lean();
    const subprojectByProjectMap = new Map();
    allSubprojects.forEach(sp => {
      const pId = sp.project_id.toString();
      if (!subprojectByProjectMap.has(pId)) {
        subprojectByProjectMap.set(pId, []);
      }
      subprojectByProjectMap.get(pId).push(sp);
    });

    // Process resources
    const resourceOps = [];

    for (const r of rows) {
      const name = norm(r["resource name"] || r["name"]);
      if (!name) continue;

      const generatedEmail = `${name.replace(/\s+/g, '.').toLowerCase()}@placeholder.com`;
      const email = norm(r["email"] || generatedEmail);
      const role = norm(r["role"] || "Employee");
      const projectsRaw = norm(r["process type"] || r["projects"]);

      // Get project IDs
      const projectIds = projectsRaw
        ? projectsRaw.split(",")
            .map(p => p.trim().toLowerCase())
            .filter(p => projectMap.has(p))
            .map(p => projectMap.get(p)._id)
        : [];

      // Get subproject IDs
      const subprojectIds = [];
      projectIds.forEach(pid => {
        const subs = subprojectByProjectMap.get(pid.toString()) || [];
        subs.forEach(sp => subprojectIds.push(sp._id));
      });

      resourceOps.push({
        updateOne: {
          filter: { email },
          update: {
            $set: { name, role },
            $setOnInsert: { email, avatar_url: DEFAULT_AVATAR },
            $addToSet: {
              assigned_projects: { $each: projectIds },
              assigned_subprojects: { $each: subprojectIds },
            }
          },
          upsert: true
        }
      });
    }

    // Bulk write
    if (resourceOps.length > 0) {
      const result = await Resource.bulkWrite(resourceOps, { ordered: false });
      console.log(`✅ Resources: ${result.upsertedCount} created, ${result.modifiedCount} updated`);
      
      fs.unlinkSync(filePath);
      
      return res.json({
        status: "success",
        message: "Resources uploaded successfully",
        summary: {
          created: result.upsertedCount,
          updated: result.modifiedCount,
          total: resourceOps.length
        }
      });
    }

    fs.unlinkSync(filePath);
    return res.json({ status: "success", message: "No valid resources found" });

  } catch (err) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    console.error("Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Helper to download error CSV
function returnErrorCsv(res, filePath, errors) {
  const parser = new Parser({ fields: ["__row", "name", "errors"] });
  const csvOut = parser.parse(errors);

  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  res.setHeader("Content-Disposition", "attachment; filename=upload-errors.csv");
  res.setHeader("Content-Type", "text/csv");
  return res.status(400).send(csvOut);
}

module.exports = router;