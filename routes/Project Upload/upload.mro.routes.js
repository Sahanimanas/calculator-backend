// routes/upload-mro.routes.js - MRO-specific Bulk Upload for Project Hierarchy
// Supports: Processing, Logging, MRO Payer Project

const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const { Parser } = require("json2csv");

const Geography = require("../../models/Geography");
const Client = require("../../models/Client");
const Project = require("../../models/Project");
const Subproject = require("../../models/Subproject");
const SubprojectRequestType = require("../../models/SubprojectRequestType");
const SubprojectRequestorType = require("../../models/SubprojectRequestorType");

const upload = multer({ dest: "uploads/" });

const norm = (s) => (typeof s === "string" ? s.trim() : "");

function normalizeName(name) {
  return name.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// ============================================
// MRO CONSTANTS
// ============================================

// MRO Process Types (Projects)
const MRO_PROCESS_TYPES = ['Processing', 'Logging', 'MRO Payer Project'];

// MRO Request Types (apply to all process types)
const MRO_REQUEST_TYPES = [
  'Batch',
  'DDS',
  'E-link',
  'E-Request',
  'Follow up',
  'New Request'
];

// MRO Requestor Types (for Processing - determines pricing)
const MRO_REQUESTOR_TYPES = [
  'NRS-NO Records',
  'Other Processing (Canceled/Released By Other)',
  'Processed',
  'Processed through File Drop'
];

// Default pricing
const MRO_DEFAULT_PRICING = {
  'Processing': {
    'NRS-NO Records': 2.25,
    'Other Processing (Canceled/Released By Other)': 0,
    'Processed': 0,
    'Processed through File Drop': 0,
    'Manual': 3.00  // Legacy/alternate
  },
  'Logging': {
    'flatrate': 1.08
  },
  'MRO Payer Project': {
    'flatrate': 0  // Define your rate
  }
};

const BATCH_SIZE = 500;

// =============================================
// MRO BULK UPLOAD - Creates hierarchy with MRO-specific structure
// =============================================
router.post("/mro-bulk-upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    console.log("⏱️ MRO Bulk Upload started...");

    // 1. Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const h = header.toLowerCase().trim();
              if (h.includes("geography")) return "geography";
              if (h.includes("location") || h.includes("subproject")) return "location";
              if (h.includes("process") && h.includes("type")) return "process_type";
              // Requestor type rates
              if (h.includes("nrs") && h.includes("rate")) return "nrs_rate";
              if (h.includes("other") && h.includes("rate")) return "other_processing_rate";
              if (h === "processed rate" || h === "processed_rate") return "processed_rate";
              if (h.includes("file drop") && h.includes("rate")) return "file_drop_rate";
              if (h.includes("manual") && h.includes("rate")) return "manual_rate";
              // Flat rate for Logging/Payer
              if (h === "flatrate" || h === "flat rate" || h.includes("logging") && h.includes("rate")) return "flatrate";
              return header;
            },
          })
        )
        .on("data", (row) => {
          if (Object.values(row).every((v) => !v)) return;
          rows.push(row);
        })
        .on("end", resolve)
        .on("error", reject);
    });

    console.log(`📄 Read ${rows.length} rows from CSV`);

    // 2. Validate rows
    const errors = [];
    const validRows = [];
    const csvDuplicateCheck = new Set();

    rows.forEach((r, idx) => {
      const geography = norm(r.geography) || "US";
      const location = norm(r.location);
      let process_type = norm(r.process_type);
      
      // Parse all rates
      const nrs_rate = parseFloat(r.nrs_rate) || MRO_DEFAULT_PRICING.Processing['NRS-NO Records'];
      const other_processing_rate = parseFloat(r.other_processing_rate) || 0;
      const processed_rate = parseFloat(r.processed_rate) || 0;
      const file_drop_rate = parseFloat(r.file_drop_rate) || 0;
      const manual_rate = parseFloat(r.manual_rate) || MRO_DEFAULT_PRICING.Processing['Manual'];
      const flatrate = parseFloat(r.flatrate) || MRO_DEFAULT_PRICING.Logging.flatrate;

      const rowOut = {
        __row: idx + 1,
        geography,
        location,
        process_type,
        nrs_rate,
        other_processing_rate,
        processed_rate,
        file_drop_rate,
        manual_rate,
        flatrate,
      };

      const rowErrors = [];

      if (!location) rowErrors.push("Location required");
      if (!process_type) rowErrors.push("Process Type required");

      // Validate process type
      const matchedProcessType = MRO_PROCESS_TYPES.find(
        (t) => t.toLowerCase() === process_type.toLowerCase()
      );
      if (!matchedProcessType && process_type) {
        rowErrors.push(`Invalid Process Type "${process_type}". Allowed: ${MRO_PROCESS_TYPES.join(", ")}`);
      } else if (matchedProcessType) {
        rowOut.process_type = matchedProcessType;
      }

      // Check for duplicates in CSV
      const uniqueKey = `${normalizeName(geography)}|${normalizeName(process_type)}|${normalizeName(location)}`;
      if (csvDuplicateCheck.has(uniqueKey)) {
        rowErrors.push("Duplicate entry in CSV");
      } else {
        csvDuplicateCheck.add(uniqueKey);
      }

      if (rowErrors.length > 0) {
        errors.push({ ...rowOut, errors: rowErrors.join("; ") });
      } else {
        validRows.push(rowOut);
      }
    });

    if (errors.length > 0) {
      return sendErrorCsv(res, filePath, errors);
    }

    if (validRows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "CSV contains no valid data rows" });
    }

    console.log(`✅ Validated ${validRows.length} rows`);

    // 3. Group data by hierarchy
    const geographyMap = new Map();

    for (const r of validRows) {
      const geoKey = normalizeName(r.geography);
      const projKey = normalizeName(r.process_type);
      const subKey = normalizeName(r.location);

      if (!geographyMap.has(geoKey)) {
        geographyMap.set(geoKey, {
          name: r.geography,
          projects: new Map()
        });
      }

      const geography = geographyMap.get(geoKey);

      if (!geography.projects.has(projKey)) {
        geography.projects.set(projKey, {
          name: r.process_type,
          subprojects: new Map()
        });
      }

      const project = geography.projects.get(projKey);

      if (!project.subprojects.has(subKey)) {
        project.subprojects.set(subKey, {
          name: r.location,
          nrs_rate: r.nrs_rate,
          other_processing_rate: r.other_processing_rate,
          processed_rate: r.processed_rate,
          file_drop_rate: r.file_drop_rate,
          manual_rate: r.manual_rate,
          flatrate: r.flatrate
        });
      }
    }

    console.log(`📊 Found ${geographyMap.size} unique geographies`);

    // 4. Create/Update hierarchy
    const stats = {
      geographies: 0,
      clients: 0,
      projects: 0,
      subprojects: 0,
      requestTypes: 0,
      requestorTypes: 0
    };

    for (const [geoKey, geoData] of geographyMap) {
      // Find or create Geography
      let geography = await Geography.findOne({ 
        name: { $regex: new RegExp(`^${geoData.name}$`, 'i') }
      });
      
      if (!geography) {
        geography = await Geography.create({
          name: geoData.name,
          description: "Created via MRO Bulk Upload",
          status: "active"
        });
        stats.geographies++;
        console.log(`✅ Created geography: ${geoData.name}`);
      }

      // Find or create MRO Client
      let mroClient = await Client.findOne({
        geography_id: geography._id,
        name: { $regex: /^MRO$/i }
      });

      if (!mroClient) {
        mroClient = await Client.create({
          name: "MRO",
          geography_id: geography._id,
          geography_name: geography.name,
          description: "MRO Client - Created via Bulk Upload",
          status: "active"
        });
        stats.clients++;
        console.log(`✅ Created MRO client under ${geography.name}`);
      }

      // Process each project (Processing/Logging/MRO Payer Project)
      for (const [projKey, projData] of geoData.projects) {
        // Find or create Project
        let project = await Project.findOne({
          client_id: mroClient._id,
          name: { $regex: new RegExp(`^${projData.name}$`, 'i') }
        });

        if (!project) {
          project = await Project.create({
            name: projData.name,
            geography_id: geography._id,
            geography_name: geography.name,
            client_id: mroClient._id,
            client_name: mroClient.name,
            description: `MRO ${projData.name} - Created via Bulk Upload`,
            status: "active",
            visibility: "visible"
          });
          stats.projects++;
          console.log(`✅ Created project: ${projData.name}`);
        }

        // Process each subproject (location)
        for (const [subKey, subData] of projData.subprojects) {
          // Determine flatrate based on process type
          let flatrate = 0;
          if (projData.name === 'Logging') {
            flatrate = subData.flatrate || MRO_DEFAULT_PRICING.Logging.flatrate;
          } else if (projData.name === 'MRO Payer Project') {
            flatrate = subData.flatrate || 0;
          }

          // Find or create Subproject
          let subproject = await Subproject.findOne({
            project_id: project._id,
            name: { $regex: new RegExp(`^${subData.name}$`, 'i') }
          });

          if (!subproject) {
            subproject = await Subproject.create({
              name: subData.name,
              geography_id: geography._id,
              geography_name: geography.name,
              client_id: mroClient._id,
              client_name: mroClient.name,
              project_id: project._id,
              project_name: project.name,
              description: `Created via MRO Bulk Upload`,
              status: "active",
              flatrate: flatrate
            });
            stats.subprojects++;
          } else {
            // Update flatrate if changed
            if (subproject.flatrate !== flatrate) {
              subproject.flatrate = flatrate;
              await subproject.save();
            }
          }

          // Create Request Types (all 6 for each subproject)
          for (const reqType of MRO_REQUEST_TYPES) {
            await SubprojectRequestType.findOneAndUpdate(
              { subproject_id: subproject._id, name: reqType },
              {
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  name: reqType,
                  rate: 0  // Request types don't have rates in MRO, requestor types do
                }
              },
              { upsert: true, new: true }
            );
            stats.requestTypes++;
          }

          // Create Requestor Types with rates (for Processing)
          if (projData.name === 'Processing') {
            console.log(`    Creating requestor types for ${subData.name}...`);
            
            // NRS-NO Records
            const nrsType = await SubprojectRequestorType.findOneAndUpdate(
              { subproject_id: subproject._id, name: 'NRS-NO Records' },
              {
                $set: { rate: subData.nrs_rate },
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  subproject_id: subproject._id,
                  name: 'NRS-NO Records'
                }
              },
              { upsert: true, new: true }
            );
            stats.requestorTypes++;

            // Other Processing
            const otherType = await SubprojectRequestorType.findOneAndUpdate(
              { subproject_id: subproject._id, name: 'Other Processing (Canceled/Released By Other)' },
              {
                $set: { rate: subData.other_processing_rate },
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  subproject_id: subproject._id,
                  name: 'Other Processing (Canceled/Released By Other)'
                }
              },
              { upsert: true, new: true }
            );
            stats.requestorTypes++;

            // Processed
            const processedType = await SubprojectRequestorType.findOneAndUpdate(
              { subproject_id: subproject._id, name: 'Processed' },
              {
                $set: { rate: subData.processed_rate },
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  subproject_id: subproject._id,
                  name: 'Processed'
                }
              },
              { upsert: true, new: true }
            );
            stats.requestorTypes++;

            // Processed through File Drop
            const fileDropType = await SubprojectRequestorType.findOneAndUpdate(
              { subproject_id: subproject._id, name: 'Processed through File Drop' },
              {
                $set: { rate: subData.file_drop_rate },
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  subproject_id: subproject._id,
                  name: 'Processed through File Drop'
                }
              },
              { upsert: true, new: true }
            );
            stats.requestorTypes++;

            // Manual (legacy/alternate pricing)
            const manualType = await SubprojectRequestorType.findOneAndUpdate(
              { subproject_id: subproject._id, name: 'Manual' },
              {
                $set: { rate: subData.manual_rate },
                $setOnInsert: {
                  geography_id: geography._id,
                  client_id: mroClient._id,
                  project_id: project._id,
                  subproject_id: subproject._id,
                  name: 'Manual'
                }
              },
              { upsert: true, new: true }
            );
            stats.requestorTypes++;
            
            console.log(`      ✅ Created 5 requestor types for ${subData.name}`);
          }
        }

        console.log(`  📦 Processed ${projData.subprojects.size} locations under ${projData.name}`);
      }
    }

    fs.unlinkSync(filePath);

    console.log(`\n🎉 MRO Bulk Upload completed!`);

    return res.json({
      status: "success",
      message: "MRO bulk upload completed successfully",
      summary: stats,
      rowsProcessed: validRows.length,
      note: "Created Request Types (Batch, DDS, E-link, E-Request, Follow up, New Request) and Requestor Types with rates for Processing locations"
    });

  } catch (err) {
    console.error("MRO Bulk upload error:", err);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: "Failed to process CSV: " + err.message });
  }
});

// =============================================
// MRO BULK UPLOAD - REPLACE MODE
// =============================================
router.post("/mro-bulk-upload-replace", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    console.log("⏱️ MRO Bulk Upload (Replace Mode) started...");

    // 1. Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const h = header.toLowerCase().trim();
              if (h.includes("geography")) return "geography";
              if (h.includes("location") || h.includes("subproject")) return "location";
              if (h.includes("process") && h.includes("type")) return "process_type";
              if (h.includes("nrs") && h.includes("rate")) return "nrs_rate";
              if (h.includes("other") && h.includes("rate")) return "other_processing_rate";
              if (h === "processed rate" || h === "processed_rate") return "processed_rate";
              if (h.includes("file drop") && h.includes("rate")) return "file_drop_rate";
              if (h.includes("manual") && h.includes("rate")) return "manual_rate";
              if (h === "flatrate" || h === "flat rate" || h.includes("logging") && h.includes("rate")) return "flatrate";
              return header;
            },
          })
        )
        .on("data", (row) => {
          if (Object.values(row).every((v) => !v)) return;
          rows.push(row);
        })
        .on("end", resolve)
        .on("error", reject);
    });

    console.log(`📄 Read ${rows.length} rows from CSV`);

    // 2. Validate rows
    const errors = [];
    const validRows = [];
    const csvDuplicateCheck = new Set();

    rows.forEach((r, idx) => {
      const geography = norm(r.geography) || "US";
      const location = norm(r.location);
      let process_type = norm(r.process_type);
      
      const nrs_rate = parseFloat(r.nrs_rate) || MRO_DEFAULT_PRICING.Processing['NRS-NO Records'];
      const other_processing_rate = parseFloat(r.other_processing_rate) || 0;
      const processed_rate = parseFloat(r.processed_rate) || 0;
      const file_drop_rate = parseFloat(r.file_drop_rate) || 0;
      const manual_rate = parseFloat(r.manual_rate) || MRO_DEFAULT_PRICING.Processing['Manual'];
      const flatrate = parseFloat(r.flatrate) || MRO_DEFAULT_PRICING.Logging.flatrate;

      const rowOut = {
        __row: idx + 1,
        geography,
        location,
        process_type,
        nrs_rate,
        other_processing_rate,
        processed_rate,
        file_drop_rate,
        manual_rate,
        flatrate,
      };

      const rowErrors = [];

      if (!location) rowErrors.push("Location required");
      if (!process_type) rowErrors.push("Process Type required");

      const matchedProcessType = MRO_PROCESS_TYPES.find(
        (t) => t.toLowerCase() === process_type.toLowerCase()
      );
      if (!matchedProcessType && process_type) {
        rowErrors.push(`Invalid Process Type "${process_type}". Allowed: ${MRO_PROCESS_TYPES.join(", ")}`);
      } else if (matchedProcessType) {
        rowOut.process_type = matchedProcessType;
      }

      const uniqueKey = `${normalizeName(geography)}|${normalizeName(process_type)}|${normalizeName(location)}`;
      if (csvDuplicateCheck.has(uniqueKey)) {
        rowErrors.push("Duplicate entry in CSV");
      } else {
        csvDuplicateCheck.add(uniqueKey);
      }

      if (rowErrors.length > 0) {
        errors.push({ ...rowOut, errors: rowErrors.join("; ") });
      } else {
        validRows.push(rowOut);
      }
    });

    if (errors.length > 0) {
      return sendErrorCsv(res, filePath, errors);
    }

    if (validRows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: "CSV contains no valid data rows" });
    }

    console.log(`✅ Validated ${validRows.length} rows`);

    // 3. Delete existing MRO data
    console.log("🗑️ Deleting existing MRO data...");
    
    const mroClients = await Client.find({ name: { $regex: /^MRO$/i } }).lean();
    const mroClientIds = mroClients.map(c => c._id);

    if (mroClientIds.length > 0) {
      const mroProjects = await Project.find({ client_id: { $in: mroClientIds } }).lean();
      const mroProjectIds = mroProjects.map(p => p._id);

      if (mroProjectIds.length > 0) {
        await SubprojectRequestType.deleteMany({ project_id: { $in: mroProjectIds } });
        await SubprojectRequestorType.deleteMany({ project_id: { $in: mroProjectIds } });
        await Subproject.deleteMany({ project_id: { $in: mroProjectIds } });
        await Project.deleteMany({ client_id: { $in: mroClientIds } });
      }
      
      console.log(`✅ Deleted MRO projects, subprojects, and types`);
    }

    // 4. Group and create data (same as incremental)
    const geographyMap = new Map();

    for (const r of validRows) {
      const geoKey = normalizeName(r.geography);
      const projKey = normalizeName(r.process_type);
      const subKey = normalizeName(r.location);

      if (!geographyMap.has(geoKey)) {
        geographyMap.set(geoKey, { name: r.geography, projects: new Map() });
      }

      const geography = geographyMap.get(geoKey);

      if (!geography.projects.has(projKey)) {
        geography.projects.set(projKey, { name: r.process_type, subprojects: new Map() });
      }

      const project = geography.projects.get(projKey);

      if (!project.subprojects.has(subKey)) {
        project.subprojects.set(subKey, {
          name: r.location,
          nrs_rate: r.nrs_rate,
          other_processing_rate: r.other_processing_rate,
          processed_rate: r.processed_rate,
          file_drop_rate: r.file_drop_rate,
          manual_rate: r.manual_rate,
          flatrate: r.flatrate
        });
      }
    }

    const stats = {
      geographies: 0,
      clients: 0,
      projects: 0,
      subprojects: 0,
      requestTypes: 0,
      requestorTypes: 0
    };

    for (const [geoKey, geoData] of geographyMap) {
      let geography = await Geography.findOne({ 
        name: { $regex: new RegExp(`^${geoData.name}$`, 'i') }
      });
      
      if (!geography) {
        geography = await Geography.create({
          name: geoData.name,
          description: "Created via MRO Bulk Upload",
          status: "active"
        });
        stats.geographies++;
      }

      let mroClient = await Client.findOne({
        geography_id: geography._id,
        name: { $regex: /^MRO$/i }
      });

      if (!mroClient) {
        mroClient = await Client.create({
          name: "MRO",
          geography_id: geography._id,
          geography_name: geography.name,
          description: "MRO Client",
          status: "active"
        });
        stats.clients++;
      }

      for (const [projKey, projData] of geoData.projects) {
        const project = await Project.create({
          name: projData.name,
          geography_id: geography._id,
          geography_name: geography.name,
          client_id: mroClient._id,
          client_name: mroClient.name,
          description: `MRO ${projData.name}`,
          status: "active",
          visibility: "visible"
        });
        stats.projects++;

        for (const [subKey, subData] of projData.subprojects) {
          let flatrate = 0;
          if (projData.name === 'Logging') {
            flatrate = subData.flatrate || MRO_DEFAULT_PRICING.Logging.flatrate;
          } else if (projData.name === 'MRO Payer Project') {
            flatrate = subData.flatrate || 0;
          }

          const subproject = await Subproject.create({
            name: subData.name,
            geography_id: geography._id,
            geography_name: geography.name,
            client_id: mroClient._id,
            client_name: mroClient.name,
            project_id: project._id,
            project_name: project.name,
            description: "Created via MRO Bulk Upload",
            status: "active",
            flatrate: flatrate
          });
          stats.subprojects++;

          // Create Request Types
          const requestTypeDocs = MRO_REQUEST_TYPES.map(reqType => ({
            geography_id: geography._id,
            client_id: mroClient._id,
            project_id: project._id,
            subproject_id: subproject._id,
            name: reqType,
            rate: 0
          }));
          await SubprojectRequestType.insertMany(requestTypeDocs, { ordered: false });
          stats.requestTypes += requestTypeDocs.length;

          // Create Requestor Types for Processing
          if (projData.name === 'Processing') {
            const requestorTypeDocs = [
              { name: 'NRS-NO Records', rate: subData.nrs_rate },
              { name: 'Other Processing (Canceled/Released By Other)', rate: subData.other_processing_rate },
              { name: 'Processed', rate: subData.processed_rate },
              { name: 'Processed through File Drop', rate: subData.file_drop_rate },
              { name: 'Manual', rate: subData.manual_rate }
            ].map(rt => ({
              geography_id: geography._id,
              client_id: mroClient._id,
              project_id: project._id,
              subproject_id: subproject._id,
              name: rt.name,
              rate: rt.rate
            }));
            await SubprojectRequestorType.insertMany(requestorTypeDocs, { ordered: false });
            stats.requestorTypes += requestorTypeDocs.length;
          }
        }

        console.log(`  📦 Created ${projData.subprojects.size} locations under ${projData.name}`);
      }
    }

    fs.unlinkSync(filePath);

    console.log(`\n🎉 MRO Bulk Upload (Replace) completed!`);

    return res.json({
      status: "success",
      message: "MRO bulk upload completed (replaced existing data)",
      summary: stats,
      rowsProcessed: validRows.length
    });

  } catch (err) {
    console.error("MRO Bulk upload error:", err);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: "Failed to process CSV: " + err.message });
  }
});

// Helper function to send error CSV
function sendErrorCsv(res, filePath, errors) {
  try {
    const fields = [
      "__row",
      "geography",
      "location",
      "process_type",
      "nrs_rate",
      "other_processing_rate",
      "processed_rate",
      "file_drop_rate",
      "manual_rate",
      "flatrate",
      "errors"
    ];
    const parser = new Parser({ fields });
    const csvOut = parser.parse(errors);

    fs.unlinkSync(filePath);
    res.setHeader("Content-Disposition", "attachment; filename=mro-upload-errors.csv");
    res.setHeader("Content-Type", "text/csv");
    return res.status(400).send(csvOut);
  } catch (err) {
    fs.unlinkSync(filePath);
    return res.status(500).json({ error: "Error generating error report" });
  }
}

module.exports = router;