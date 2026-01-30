// routes/upload-resource.routes.js - Resource CSV Upload with correct assignments structure
const express = require("express");
const router = express.Router();
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const { Parser } = require("json2csv");

const Resource = require("../models/Resource");
const Geography = require("../models/Geography");
const Client = require("../models/Client");
const Project = require("../models/Project");
const Subproject = require("../models/Subproject");

const upload = multer({ dest: "uploads/" });

const norm = (s) => (typeof s === "string" ? s.trim() : "");

// =============================================
// RESOURCE BULK UPLOAD
// CSV Format: Name, Location, Process Type, Client, Geography, Email ID
// Saves to assignments array with proper structure:
// assignments: [{ geography_id, geography_name, client_id, client_name, project_id, project_name, subprojects: [{ subproject_id, subproject_name }] }]
// =============================================
router.post("/bulk", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    console.log("⏱️ Resource Bulk Upload started...");

    // 1. Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const h = header.toLowerCase().trim();
              if (h === "name" || h === "resource name" || h === "resource") return "name";
              if (h === "location" || h === "subproject" || h === "sub-project" || h === "sub project") return "location";
              if (h === "process type" || h === "process_type" || h === "processtype" || h === "project") return "process_type";
              if (h === "client" || h === "client name" || h === "client_name") return "client";
              if (h === "geography" || h === "geo" || h === "region") return "geography";
              if (h === "email" || h === "email id" || h === "email_id" || h === "emailid") return "email";
              if (h === "role") return "role";
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

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const rowNum = idx + 2;

      const name = norm(r.name);
      const location = norm(r.location);
      const processType = norm(r.process_type);
      const clientName = norm(r.client);
      const geographyName = norm(r.geography);
      const email = norm(r.email);
      const role = norm(r.role) || "associate";

      const rowErrors = [];

      if (!name) rowErrors.push("Name is required");
      if (!email) rowErrors.push("Email is required");
      if (!location) rowErrors.push("Location is required");
      if (!processType) rowErrors.push("Process Type is required");
      if (!clientName) rowErrors.push("Client is required");
      if (!geographyName) rowErrors.push("Geography is required");

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        rowErrors.push("Invalid email format");
      }

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNum,
          name,
          location,
          process_type: processType,
          client: clientName,
          geography: geographyName,
          email,
          errors: rowErrors.join("; "),
        });
      } else {
        validRows.push({
          rowNum,
          name,
          location,
          processType,
          clientName,
          geographyName,
          email,
          role,
        });
      }
    }

    console.log(`✅ Validated: ${validRows.length} valid, ${errors.length} errors`);

    // 3. Process valid rows - Group by resource email
    // Build assignments in the correct format
    const resourceMap = new Map(); // email -> { name, email, role, assignmentsMap }

    for (const row of validRows) {
      // Find Geography
      const geography = await Geography.findOne({
        name: { $regex: new RegExp(`^${row.geographyName}$`, "i") },
      }).lean();

      if (!geography) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Geography "${row.geographyName}" not found`,
        });
        continue;
      }

      // Find Client
      const client = await Client.findOne({
        geography_id: geography._id,
        name: { $regex: new RegExp(`^${row.clientName}$`, "i") },
      }).lean();

      if (!client) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Client "${row.clientName}" not found under geography "${row.geographyName}"`,
        });
        continue;
      }

      // Find Project (Process Type)
      let project = await Project.findOne({
        client_id: client._id,
        name: { $regex: new RegExp(`^${row.processType}$`, "i") },
      }).lean();

      // Try partial match if exact match not found
      if (!project) {
        const processTypeWords = row.processType.toLowerCase().split(/\s+/);
        const lastWord = processTypeWords[processTypeWords.length - 1];
        
        project = await Project.findOne({
          client_id: client._id,
          name: { $regex: new RegExp(lastWord, "i") },
        }).lean();
      }

      if (!project) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Process Type "${row.processType}" not found under client "${row.clientName}"`,
        });
        continue;
      }

      // Find Subproject (Location)
      const subproject = await Subproject.findOne({
        project_id: project._id,
        name: { $regex: new RegExp(`^${row.location}$`, "i") },
      }).lean();

      if (!subproject) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Location "${row.location}" not found under process type "${project.name}"`,
        });
        continue;
      }

      // Add to resource map with proper assignment structure
      const emailKey = row.email.toLowerCase();
      if (!resourceMap.has(emailKey)) {
        resourceMap.set(emailKey, {
          name: row.name,
          email: row.email,
          role: row.role,
          // Map: "geoId|clientId|projectId" -> assignment object
          assignmentsMap: new Map(),
        });
      }

      const resourceData = resourceMap.get(emailKey);
      
      // Create key for this assignment group (geography + client + project)
      const assignmentKey = `${geography._id}|${client._id}|${project._id}`;
      
      if (!resourceData.assignmentsMap.has(assignmentKey)) {
        resourceData.assignmentsMap.set(assignmentKey, {
          geography_id: geography._id,
          geography_name: geography.name,
          client_id: client._id,
          client_name: client.name,
          project_id: project._id,
          project_name: project.name,
          subprojectsMap: new Map(), // subproject_id string -> { subproject_id, subproject_name }
        });
      }

      // Add subproject to this assignment
      const assignment = resourceData.assignmentsMap.get(assignmentKey);
      const spIdStr = subproject._id.toString();
      if (!assignment.subprojectsMap.has(spIdStr)) {
        assignment.subprojectsMap.set(spIdStr, {
          subproject_id: subproject._id,
          subproject_name: subproject.name,
        });
      }
    }

    // 4. Create/Update Resources with proper assignments structure
    const stats = {
      created: 0,
      updated: 0,
      assignments: 0,
    };

    for (const [email, data] of resourceMap) {
      // Convert maps to arrays for the assignments
      const newAssignments = [];
      for (const [, assignmentData] of data.assignmentsMap) {
        const subprojects = Array.from(assignmentData.subprojectsMap.values());
        newAssignments.push({
          geography_id: assignmentData.geography_id,
          geography_name: assignmentData.geography_name,
          client_id: assignmentData.client_id,
          client_name: assignmentData.client_name,
          project_id: assignmentData.project_id,
          project_name: assignmentData.project_name,
          subprojects: subprojects,
        });
        stats.assignments += subprojects.length;
      }

      // Check if resource exists
      let resource = await Resource.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } });

      if (resource) {
        // Merge assignments with existing ones
        for (const newAssignment of newAssignments) {
          // Find existing assignment with same geo/client/project
          const existingAssignmentIndex = resource.assignments.findIndex(
            (a) =>
              a.geography_id?.toString() === newAssignment.geography_id.toString() &&
              a.client_id?.toString() === newAssignment.client_id.toString() &&
              a.project_id?.toString() === newAssignment.project_id.toString()
          );

          if (existingAssignmentIndex >= 0) {
            // Merge subprojects into existing assignment
            const existingAssignment = resource.assignments[existingAssignmentIndex];
            for (const newSp of newAssignment.subprojects) {
              const spExists = existingAssignment.subprojects?.some(
                (sp) => sp.subproject_id?.toString() === newSp.subproject_id.toString()
              );
              if (!spExists) {
                if (!existingAssignment.subprojects) {
                  existingAssignment.subprojects = [];
                }
                existingAssignment.subprojects.push(newSp);
              }
            }
          } else {
            // Add new assignment
            resource.assignments.push(newAssignment);
          }
        }

        resource.name = data.name;
        resource.role = data.role;
        await resource.save();
        stats.updated++;
      } else {
        // Create new resource
        resource = new Resource({
          name: data.name,
          email: data.email,
          role: data.role,
          status: "active",
          assignments: newAssignments,
          login_count: 0,
          total_logins: 0,
          otp_attempts: 0,
        });

        await resource.save();
        stats.created++;
      }
    }

    // Clean up
    fs.unlinkSync(filePath);

    // If there were errors, return error CSV
    if (errors.length > 0) {
      const fields = ["row", "name", "location", "process_type", "client", "geography", "email", "errors"];
      const parser = new Parser({ fields });
      const csvOut = parser.parse(errors);

      res.setHeader("Content-Disposition", "attachment; filename=resource-upload-errors.csv");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("X-Has-Errors", "true");
      res.setHeader("X-Stats", JSON.stringify(stats));
      return res.status(207).send(csvOut);
    }

    console.log(`\n🎉 Resource Bulk Upload completed!`);
    console.log(`   Created: ${stats.created}, Updated: ${stats.updated}, Assignments: ${stats.assignments}`);

    return res.json({
      status: "success",
      message: `Successfully processed ${resourceMap.size} resources`,
      stats,
    });
  } catch (err) {
    console.error("Resource Bulk upload error:", err);
    try {
      fs.unlinkSync(filePath);
    } catch {}
    return res.status(500).json({ error: "Failed to process CSV: " + err.message });
  }
});

// =============================================
// RESOURCE BULK UPLOAD - REPLACE MODE
// Clears existing assignments before adding new ones
// =============================================
router.post("/bulk-replace", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const rows = [];

  try {
    console.log("⏱️ Resource Bulk Upload (Replace Mode) started...");

    // 1. Read CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(
          csv({
            mapHeaders: ({ header }) => {
              const h = header.toLowerCase().trim();
              if (h === "name" || h === "resource name" || h === "resource") return "name";
              if (h === "location" || h === "subproject" || h === "sub-project" || h === "sub project") return "location";
              if (h === "process type" || h === "process_type" || h === "processtype" || h === "project") return "process_type";
              if (h === "client" || h === "client name" || h === "client_name") return "client";
              if (h === "geography" || h === "geo" || h === "region") return "geography";
              if (h === "email" || h === "email id" || h === "email_id" || h === "emailid") return "email";
              if (h === "role") return "role";
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

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const rowNum = idx + 2;

      const name = norm(r.name);
      const location = norm(r.location);
      const processType = norm(r.process_type);
      const clientName = norm(r.client);
      const geographyName = norm(r.geography);
      const email = norm(r.email);
      const role = norm(r.role) || "associate";

      const rowErrors = [];

      if (!name) rowErrors.push("Name is required");
      if (!email) rowErrors.push("Email is required");
      if (!location) rowErrors.push("Location is required");
      if (!processType) rowErrors.push("Process Type is required");
      if (!clientName) rowErrors.push("Client is required");
      if (!geographyName) rowErrors.push("Geography is required");

      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        rowErrors.push("Invalid email format");
      }

      if (rowErrors.length > 0) {
        errors.push({
          row: rowNum,
          name,
          location,
          process_type: processType,
          client: clientName,
          geography: geographyName,
          email,
          errors: rowErrors.join("; "),
        });
      } else {
        validRows.push({
          rowNum,
          name,
          location,
          processType,
          clientName,
          geographyName,
          email,
          role,
        });
      }
    }

    // 3. Process valid rows
    const resourceMap = new Map();

    for (const row of validRows) {
      const geography = await Geography.findOne({
        name: { $regex: new RegExp(`^${row.geographyName}$`, "i") },
      }).lean();

      if (!geography) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Geography "${row.geographyName}" not found`,
        });
        continue;
      }

      const client = await Client.findOne({
        geography_id: geography._id,
        name: { $regex: new RegExp(`^${row.clientName}$`, "i") },
      }).lean();

      if (!client) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Client "${row.clientName}" not found`,
        });
        continue;
      }

      let project = await Project.findOne({
        client_id: client._id,
        name: { $regex: new RegExp(`^${row.processType}$`, "i") },
      }).lean();

      if (!project) {
        const processTypeWords = row.processType.toLowerCase().split(/\s+/);
        const lastWord = processTypeWords[processTypeWords.length - 1];
        
        project = await Project.findOne({
          client_id: client._id,
          name: { $regex: new RegExp(lastWord, "i") },
        }).lean();
      }

      if (!project) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Process Type "${row.processType}" not found`,
        });
        continue;
      }

      const subproject = await Subproject.findOne({
        project_id: project._id,
        name: { $regex: new RegExp(`^${row.location}$`, "i") },
      }).lean();

      if (!subproject) {
        errors.push({
          row: row.rowNum,
          name: row.name,
          location: row.location,
          process_type: row.processType,
          client: row.clientName,
          geography: row.geographyName,
          email: row.email,
          errors: `Location "${row.location}" not found`,
        });
        continue;
      }

      const emailKey = row.email.toLowerCase();
      if (!resourceMap.has(emailKey)) {
        resourceMap.set(emailKey, {
          name: row.name,
          email: row.email,
          role: row.role,
          assignmentsMap: new Map(),
        });
      }

      const resourceData = resourceMap.get(emailKey);
      const assignmentKey = `${geography._id}|${client._id}|${project._id}`;
      
      if (!resourceData.assignmentsMap.has(assignmentKey)) {
        resourceData.assignmentsMap.set(assignmentKey, {
          geography_id: geography._id,
          geography_name: geography.name,
          client_id: client._id,
          client_name: client.name,
          project_id: project._id,
          project_name: project.name,
          subprojectsMap: new Map(),
        });
      }

      const assignment = resourceData.assignmentsMap.get(assignmentKey);
      const spIdStr = subproject._id.toString();
      if (!assignment.subprojectsMap.has(spIdStr)) {
        assignment.subprojectsMap.set(spIdStr, {
          subproject_id: subproject._id,
          subproject_name: subproject.name,
        });
      }
    }

    // 4. Create/Update Resources (Replace mode - overwrite assignments)
    const stats = {
      created: 0,
      updated: 0,
      assignments: 0,
    };

    for (const [email, data] of resourceMap) {
      const newAssignments = [];
      for (const [, assignmentData] of data.assignmentsMap) {
        const subprojects = Array.from(assignmentData.subprojectsMap.values());
        newAssignments.push({
          geography_id: assignmentData.geography_id,
          geography_name: assignmentData.geography_name,
          client_id: assignmentData.client_id,
          client_name: assignmentData.client_name,
          project_id: assignmentData.project_id,
          project_name: assignmentData.project_name,
          subprojects: subprojects,
        });
        stats.assignments += subprojects.length;
      }

      let resource = await Resource.findOne({ email: { $regex: new RegExp(`^${email}$`, "i") } });

      if (resource) {
        // Replace mode: completely replace assignments
        resource.name = data.name;
        resource.role = data.role;
        resource.assignments = newAssignments;
        await resource.save();
        stats.updated++;
      } else {
        resource = new Resource({
          name: data.name,
          email: data.email,
          role: data.role,
          status: "active",
          assignments: newAssignments,
          login_count: 0,
          total_logins: 0,
          otp_attempts: 0,
        });

        await resource.save();
        stats.created++;
      }
    }

    fs.unlinkSync(filePath);

    if (errors.length > 0) {
      const fields = ["row", "name", "location", "process_type", "client", "geography", "email", "errors"];
      const parser = new Parser({ fields });
      const csvOut = parser.parse(errors);

      res.setHeader("Content-Disposition", "attachment; filename=resource-upload-errors.csv");
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("X-Has-Errors", "true");
      res.setHeader("X-Stats", JSON.stringify(stats));
      return res.status(207).send(csvOut);
    }

    console.log(`\n🎉 Resource Bulk Upload (Replace) completed!`);

    return res.json({
      status: "success",
      message: `Successfully processed ${resourceMap.size} resources`,
      stats,
    });
  } catch (err) {
    console.error("Resource Bulk upload error:", err);
    try {
      fs.unlinkSync(filePath);
    } catch {}
    return res.status(500).json({ error: "Failed to process CSV: " + err.message });
  }
});

module.exports = router;