// routes/upload.js - UPDATED for Geography → Client → Project → Subproject hierarchy
const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const { Parser } = require("json2csv");
const mongoose = require("mongoose");

const Geography = require("../../models/Geography");
const Client = require("../../models/Client");
const Project = require("../../models/Project");
const Subproject = require("../../models/Subproject");
const SubprojectRequestType = require("../../models/SubprojectRequestType");
const Billing = require("../../models/Billing");
const upload = multer({ dest: "uploads/" });

// Helper to clean strings
const norm = (s) => (typeof s === "string" ? s.trim() : "");

// Helper to normalize names for comparison
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// All 3 request types
const ALL_REQUEST_TYPES = ["New Request", "Key", "Duplicate"];

// Batch size for bulk operations
const BATCH_SIZE = 500;

// =============================================
// MAIN BULK UPLOAD - REPLACES ALL DATA
// =============================================
router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    // 1. Read CSV and Map Headers
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const cleanHeader = header.toLowerCase().trim();
              if (cleanHeader.includes("geography")) return "geography";
              if (cleanHeader.includes("client")) return "client";
              if (cleanHeader.includes("process type")) return "project_name";
              if (cleanHeader.includes("location")) return "subproject_name";
              if (cleanHeader.includes("request type")) return "request_type";
              if (cleanHeader.includes("costing rate") || cleanHeader === "rate") return "rate";
              if (cleanHeader.includes("flat rate")) return "flatrate";
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

    const errors = [];
    const validRows = [];
    const csvDuplicateCheck = new Set();

    // 2. Validate rows
    rows.forEach((r, idx) => {
      const geography = norm(r.geography);
      const client = norm(r.client);
      const project_name = norm(r.project_name);
      const subproject_name = norm(r.subproject_name);
      let request_type = norm(r.request_type);
      
      const rateStr = r.rate !== undefined ? String(r.rate).trim() : "0";
      const rate = parseFloat(rateStr);

      const flatrateStr = r.flatrate !== undefined ? String(r.flatrate).trim() : "0";
      const flatrate = parseFloat(flatrateStr);

      const rowOut = {
        __row: idx + 1,
        geography,
        client,
        project_name,
        subproject_name,
        request_type,
        rate,
        flatrate,
      };

      const rowErrors = [];

      if (!geography) rowErrors.push("Geography required");
      if (!client) rowErrors.push("Client required");
      if (!project_name) rowErrors.push("Process Type required");
      if (!subproject_name) rowErrors.push("Location required");
      if (!request_type) rowErrors.push("Request Type required");
      if (isNaN(rate)) rowErrors.push("Rate must be a number");
      if (isNaN(flatrate)) rowErrors.push("Flat Rate must be a number");

      const matchedType = ALL_REQUEST_TYPES.find(
        (t) => t.toLowerCase() === request_type.toLowerCase()
      );
      if (!matchedType && request_type) {
        rowErrors.push(`Invalid Request Type. Allowed: ${ALL_REQUEST_TYPES.join(", ")}`);
      } else if (matchedType) {
        rowOut.request_type = matchedType;
      }

      const uniqueKey = `${normalizeName(geography)}|${normalizeName(client)}|${normalizeName(project_name)}|${normalizeName(subproject_name)}|${normalizeName(request_type)}`;
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

    // =============================================
    // 3. Process data WITHOUT transaction (for large datasets)
    // =============================================

    // Step 3a: Delete old data in batches
    console.log("Deleting old data...");
    await SubprojectRequestType.deleteMany({});
    await Subproject.deleteMany({});
    await Project.deleteMany({});
    await Client.deleteMany({});
    await Geography.deleteMany({});
    await Billing.deleteMany({});
    console.log("✅ Old data deleted");

    // Step 3b: Group data by hierarchy: geography -> client -> project -> subproject -> request types
    const geographyMap = new Map(); // geographyKey -> { name, clients: Map }

    for (const r of validRows) {
      const geoKey = normalizeName(r.geography);
      const clientKey = normalizeName(r.client);
      const projKey = normalizeName(r.project_name);
      const subKey = normalizeName(r.subproject_name);

      // Create geography if not exists
      if (!geographyMap.has(geoKey)) {
        geographyMap.set(geoKey, {
          name: r.geography,
          clients: new Map()
        });
      }

      const geography = geographyMap.get(geoKey);
      
      // Create client if not exists
      if (!geography.clients.has(clientKey)) {
        geography.clients.set(clientKey, {
          name: r.client,
          projects: new Map()
        });
      }

      const client = geography.clients.get(clientKey);

      // Create project if not exists
      if (!client.projects.has(projKey)) {
        client.projects.set(projKey, {
          name: r.project_name,
          subprojects: new Map()
        });
      }

      const project = client.projects.get(projKey);
      
      // Create subproject if not exists
      if (!project.subprojects.has(subKey)) {
        project.subprojects.set(subKey, {
          name: r.subproject_name,
          flatrate: r.flatrate,
          rates: new Map()
        });
      }

      const subproject = project.subprojects.get(subKey);
      subproject.rates.set(r.request_type, r.rate);
      
      // Update flatrate if higher
      if (r.flatrate > subproject.flatrate) {
        subproject.flatrate = r.flatrate;
      }
    }

    console.log(`📊 Found ${geographyMap.size} unique geographies`);

    // Step 3c: Create Geographies in batch
    console.log("📝 Creating geographies...");
    const geographyDocs = [];
    for (const [key, data] of geographyMap) {
      geographyDocs.push({
        name: data.name,
        description: "Imported via Bulk Upload",
        status: "active"
      });
    }

    const createdGeographies = await Geography.insertMany(geographyDocs, { ordered: false });
    
    // Map geography names to IDs
    const geographyIdMap = new Map();
    createdGeographies.forEach(g => {
      geographyIdMap.set(normalizeName(g.name), g._id);
    });
    console.log(`✅ Created ${createdGeographies.length} geographies`);

    // Step 3d: Create Clients in batch
    console.log("📝 Creating clients...");
    const clientDocs = [];
    
    for (const [geoKey, geoData] of geographyMap) {
      const geographyId = geographyIdMap.get(geoKey);
      if (!geographyId) continue;

      for (const [clientKey, clientData] of geoData.clients) {
        clientDocs.push({
          name: clientData.name,
          geography_id: geographyId,
          geography_name: geoData.name,
          description: "Imported via Bulk Upload",
          status: "active",
          _tempKey: `${geoKey}|${clientKey}` // Temporary key for mapping
        });
      }
    }

    const clientIdMap = new Map();
    let totalClients = 0;

    for (let i = 0; i < clientDocs.length; i += BATCH_SIZE) {
      const batch = clientDocs.slice(i, i + BATCH_SIZE);
      
      // Remove temp fields before insert
      const cleanBatch = batch.map(({ _tempKey, ...doc }) => doc);
      
      const created = await Client.insertMany(cleanBatch, { ordered: false });
      
      // Map back using index
      created.forEach((c, idx) => {
        const originalDoc = batch[idx];
        clientIdMap.set(originalDoc._tempKey, c._id);
      });

      totalClients += created.length;
      console.log(`  📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Created ${created.length} clients (Total: ${totalClients})`);
    }

    console.log(`✅ Created ${totalClients} clients`);

    // Step 3e: Create Projects in batch
    console.log("📝 Creating projects...");
    const projectDocs = [];
    
    for (const [geoKey, geoData] of geographyMap) {
      const geographyId = geographyIdMap.get(geoKey);
      if (!geographyId) continue;

      for (const [clientKey, clientData] of geoData.clients) {
        const clientTempKey = `${geoKey}|${clientKey}`;
        const clientId = clientIdMap.get(clientTempKey);
        if (!clientId) continue;

        for (const [projKey, projData] of clientData.projects) {
          projectDocs.push({
            name: projData.name,
            geography_id: geographyId,
            geography_name: geoData.name,
            client_id: clientId,
            client_name: clientData.name,
            description: "Imported via Bulk Upload",
            status: "active",
            visibility: "visible",
            _tempKey: `${geoKey}|${clientKey}|${projKey}` // Temporary key for mapping
          });
        }
      }
    }

    const projectIdMap = new Map();
    let totalProjects = 0;

    for (let i = 0; i < projectDocs.length; i += BATCH_SIZE) {
      const batch = projectDocs.slice(i, i + BATCH_SIZE);
      
      // Remove temp fields before insert
      const cleanBatch = batch.map(({ _tempKey, ...doc }) => doc);
      
      const created = await Project.insertMany(cleanBatch, { ordered: false });
      
      // Map back using index
      created.forEach((p, idx) => {
        const originalDoc = batch[idx];
        projectIdMap.set(originalDoc._tempKey, p._id);
      });

      totalProjects += created.length;
      console.log(`  📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Created ${created.length} projects (Total: ${totalProjects})`);
    }

    console.log(`✅ Created ${totalProjects} projects`);

    // Step 3f: Create Subprojects in batches
    console.log("📝 Creating subprojects...");
    const subprojectDocs = [];
    
    for (const [geoKey, geoData] of geographyMap) {
      const geographyId = geographyIdMap.get(geoKey);
      if (!geographyId) continue;

      for (const [clientKey, clientData] of geoData.clients) {
        const clientTempKey = `${geoKey}|${clientKey}`;
        const clientId = clientIdMap.get(clientTempKey);
        if (!clientId) continue;

        for (const [projKey, projData] of clientData.projects) {
          const projTempKey = `${geoKey}|${clientKey}|${projKey}`;
          const projectId = projectIdMap.get(projTempKey);
          if (!projectId) continue;

          for (const [subKey, subData] of projData.subprojects) {
            subprojectDocs.push({
              name: subData.name,
              geography_id: geographyId,
              geography_name: geoData.name,
              client_id: clientId,
              client_name: clientData.name,
              project_id: projectId,
              project_name: projData.name,
              description: "Imported via Bulk Upload",
              status: "active",
              flatrate: subData.flatrate,
              _tempKey: `${geoKey}|${clientKey}|${projKey}|${subKey}`, // Temporary key for mapping
              _rates: subData.rates // Temporary for request types
            });
          }
        }
      }
    }

    // Insert subprojects in batches
    const subprojectIdMap = new Map();
    let totalSubprojects = 0;

    for (let i = 0; i < subprojectDocs.length; i += BATCH_SIZE) {
      const batch = subprojectDocs.slice(i, i + BATCH_SIZE);
      
      // Remove temp fields before insert
      const cleanBatch = batch.map(({ _tempKey, _rates, ...doc }) => doc);
      
      const created = await Subproject.insertMany(cleanBatch, { ordered: false });
      
      // Map back using index
      created.forEach((sp, idx) => {
        const originalDoc = batch[idx];
        subprojectIdMap.set(originalDoc._tempKey, {
          _id: sp._id,
          rates: originalDoc._rates
        });
      });

      totalSubprojects += created.length;
      console.log(`  📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: Created ${created.length} subprojects (Total: ${totalSubprojects})`);
    }

    console.log(`✅ Created ${totalSubprojects} subprojects`);

    // Step 3g: Create Request Types in batches (3 per subproject)
    console.log("📝 Creating request types...");
    const requestTypeDocs = [];

    for (const [geoKey, geoData] of geographyMap) {
      const geographyId = geographyIdMap.get(geoKey);
      if (!geographyId) continue;

      for (const [clientKey, clientData] of geoData.clients) {
        const clientTempKey = `${geoKey}|${clientKey}`;
        const clientId = clientIdMap.get(clientTempKey);
        if (!clientId) continue;

        for (const [projKey, projData] of clientData.projects) {
          const projTempKey = `${geoKey}|${clientKey}|${projKey}`;
          const projectId = projectIdMap.get(projTempKey);
          if (!projectId) continue;

          for (const [subKey, subData] of projData.subprojects) {
            const tempKey = `${geoKey}|${clientKey}|${projKey}|${subKey}`;
            const subInfo = subprojectIdMap.get(tempKey);
            if (!subInfo) continue;

            // Create all 3 request types
            for (const reqType of ALL_REQUEST_TYPES) {
              const rate = subData.rates.get(reqType) || 0;
              requestTypeDocs.push({
                geography_id: geographyId,
                client_id: clientId,
                project_id: projectId,
                subproject_id: subInfo._id,
                name: reqType,
                rate: rate
              });
            }
          }
        }
      }
    }

    // Insert request types in batches
    let totalRequestTypes = 0;

    for (let i = 0; i < requestTypeDocs.length; i += BATCH_SIZE) {
      const batch = requestTypeDocs.slice(i, i + BATCH_SIZE);
      
      await SubprojectRequestType.insertMany(batch, { ordered: false });
      
      totalRequestTypes += batch.length;
      
      if ((i / BATCH_SIZE) % 10 === 0) {
        console.log(`  📦 Request types progress: ${totalRequestTypes}/${requestTypeDocs.length}`);
      }
    }

    console.log(`✅ Created ${totalRequestTypes} request types`);

    // Cleanup
    fs.unlinkSync(filePath);

    return res.json({
      status: "success",
      message: "Bulk upload completed successfully.",
      summary: {
        geographies: createdGeographies.length,
        clients: totalClients,
        projects: totalProjects,
        subprojects: totalSubprojects,
        requestTypes: totalRequestTypes,
        note: "All 3 request types (New Request, Key, Duplicate) created for each subproject"
      },
      rowsProcessed: validRows.length,
    });

  } catch (err) {
    console.error("Bulk upload error:", err);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: "Failed to process CSV: " + err.message });
  }
});

// =============================================
// INCREMENTAL UPLOAD (doesn't delete existing data)
// =============================================
router.post("/bulk-upload-incremental", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    // Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const cleanHeader = header.toLowerCase().trim();
              if (cleanHeader.includes("geography")) return "geography";
              if (cleanHeader.includes("client")) return "client";
              if (cleanHeader.includes("process type")) return "project_name";
              if (cleanHeader.includes("location")) return "subproject_name";
              if (cleanHeader.includes("request type")) return "request_type";
              if (cleanHeader.includes("costing rate") || cleanHeader === "rate") return "rate";
              if (cleanHeader.includes("flat rate")) return "flatrate";
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

    // Validate
    const validRows = [];
    for (const r of rows) {
      const geography = norm(r.geography);
      const client = norm(r.client);
      const project_name = norm(r.project_name);
      const subproject_name = norm(r.subproject_name);
      const request_type = norm(r.request_type);
      const rate = parseFloat(r.rate) || 0;
      const flatrate = parseFloat(r.flatrate) || 0;

      if (!geography || !client || !project_name || !subproject_name || !request_type) continue;

      const matchedType = ALL_REQUEST_TYPES.find(
        (t) => t.toLowerCase() === request_type.toLowerCase()
      );
      if (!matchedType) continue;

      validRows.push({
        geography,
        client,
        project_name,
        subproject_name,
        request_type: matchedType,
        rate,
        flatrate
      });
    }

    console.log(`✅ Validated ${validRows.length} rows`);

    // Group by hierarchy
    const geographyMap = new Map();

    for (const r of validRows) {
      const geoKey = normalizeName(r.geography);
      const clientKey = normalizeName(r.client);
      const projKey = normalizeName(r.project_name);
      const subKey = normalizeName(r.subproject_name);

      if (!geographyMap.has(geoKey)) {
        geographyMap.set(geoKey, {
          name: r.geography,
          clients: new Map()
        });
      }

      const geography = geographyMap.get(geoKey);
      
      if (!geography.clients.has(clientKey)) {
        geography.clients.set(clientKey, {
          name: r.client,
          projects: new Map()
        });
      }

      const client = geography.clients.get(clientKey);

      if (!client.projects.has(projKey)) {
        client.projects.set(projKey, {
          name: r.project_name,
          subprojects: new Map()
        });
      }

      const project = client.projects.get(projKey);
      
      if (!project.subprojects.has(subKey)) {
        project.subprojects.set(subKey, {
          name: r.subproject_name,
          flatrate: r.flatrate,
          rates: new Map()
        });
      }

      const subproject = project.subprojects.get(subKey);
      subproject.rates.set(r.request_type, r.rate);
      if (r.flatrate > subproject.flatrate) {
        subproject.flatrate = r.flatrate;
      }
    }

    // Process with upsert (no delete)
    let geographyCount = 0;
    let clientCount = 0;
    let projectCount = 0;
    let subprojectCount = 0;
    let requestTypeCount = 0;

    for (const [geoKey, geoData] of geographyMap) {
      // Upsert geography
      const geography = await Geography.findOneAndUpdate(
        { name: geoData.name },
        { 
          $set: { name: geoData.name },
          $setOnInsert: { description: "Imported via Bulk Upload", status: "active" }
        },
        { upsert: true, new: true }
      );
      geographyCount++;

      for (const [clientKey, clientData] of geoData.clients) {
        // Upsert client
        const client = await Client.findOneAndUpdate(
          { name: clientData.name, geography_id: geography._id },
          {
            $set: { name: clientData.name, geography_name: geography.name },
            $setOnInsert: { description: "Imported via Bulk Upload", status: "active" }
          },
          { upsert: true, new: true }
        );
        clientCount++;

        for (const [projKey, projData] of clientData.projects) {
          // Upsert project
          const project = await Project.findOneAndUpdate(
            { name: projData.name, client_id: client._id },
            {
              $set: { 
                name: projData.name, 
                geography_name: geography.name,
                client_name: client.name
              },
              $setOnInsert: { 
                geography_id: geography._id,
                description: "Imported via Bulk Upload", 
                status: "active",
                visibility: "visible"
              }
            },
            { upsert: true, new: true }
          );
          projectCount++;

          for (const [subKey, subData] of projData.subprojects) {
            // Upsert subproject
            const subproject = await Subproject.findOneAndUpdate(
              { name: subData.name, project_id: project._id },
              {
                $set: { 
                  name: subData.name, 
                  flatrate: subData.flatrate,
                  geography_name: geography.name,
                  client_name: client.name,
                  project_name: project.name
                },
                $setOnInsert: { 
                  geography_id: geography._id,
                  client_id: client._id,
                  description: "Imported via Bulk Upload",
                  status: "active"
                }
              },
              { upsert: true, new: true }
            );
            subprojectCount++;

            // Upsert all 3 request types
            for (const reqType of ALL_REQUEST_TYPES) {
              const rate = subData.rates.get(reqType) || 0;
              await SubprojectRequestType.findOneAndUpdate(
                { subproject_id: subproject._id, name: reqType },
                {
                  $set: { rate: rate },
                  $setOnInsert: { 
                    geography_id: geography._id,
                    client_id: client._id,
                    project_id: project._id, 
                    name: reqType 
                  }
                },
                { upsert: true }
              );
              requestTypeCount++;
            }
          }
        }

        if (clientCount % 10 === 0) {
          console.log(`  Progress: ${clientCount} clients, ${projectCount} projects, ${subprojectCount} subprojects processed`);
        }
      }
    }

    fs.unlinkSync(filePath);

    return res.json({
      status: "success",
      message: "Incremental upload completed.",
      summary: {
        geographies: geographyCount,
        clients: clientCount,
        projects: projectCount,
        subprojects: subprojectCount,
        requestTypes: requestTypeCount
      }
    });

  } catch (err) {
    console.error("Upload error:", err);
    try { fs.unlinkSync(filePath); } catch {}
    return res.status(500).json({ error: err.message });
  }
});

// Helper function to send error CSV
function sendErrorCsv(res, filePath, errors) {
  try {
    const fields = [
      "__row", 
      "geography", 
      "client", 
      "project_name", 
      "subproject_name", 
      "request_type", 
      "rate", 
      "flatrate", 
      "errors"
    ];
    const parser = new Parser({ fields });
    const csvOut = parser.parse(errors);

    fs.unlinkSync(filePath);
    res.setHeader("Content-Disposition", "attachment; filename=bulk-upload-errors.csv");
    res.setHeader("Content-Type", "text/csv");
    return res.status(400).send(csvOut);
  } catch (err) {
    return res.status(500).json({ error: "Error generating error report" });
  }
}

module.exports = router;