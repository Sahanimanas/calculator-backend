// routes/projectBulkUpload.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const { Parser } = require('json2csv'); // npm i json2csv
const mongoose = require('mongoose');

const Project = require('../models/Project');
const Subproject = require('../models/Subproject');

const upload = multer({ dest: 'uploads/' });

/**
 * POST /api/projects/bulk-upload
 * Query params:
 *   dryRun=true         -> Validate & plan only (no DB writes)
 *   downloadErrors=true -> If true and errors exist, respond with CSV attachment of errors
 *
 * Form:
 *   multipart/form-data, field: file
 */
router.post('/bulk-upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = req.file.path;
  const dryRun = req.query.dryRun === 'true';
  const downloadErrors = req.query.downloadErrors === 'true';

  const rows = [];
  try {
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => rows.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    // Normalization helper
    const norm = (s) => (typeof s === 'string' ? s.trim() : '');

    // Validate rows & build normalized records
    const errors = [];
    const normalized = rows.map((r, idx) => {
      const project_name = norm(r.project_name || r.project || r.name);
      const project_description = norm(r.project_description || r.project_description);
      const visibility = norm(r.visibility || 'visible') || 'visible';
      const status = norm(r.status || 'active') || 'active';
      const flatrate = r.flatrate !== undefined ? Number(r.flatrate || 0) : 0;

      const subproject_name = norm(r.subproject_name || r.subproject || r.subproject_name);
      const subproject_description = norm(r.subproject_description || '');
      const subproject_status = norm(r.subproject_status || 'active') || 'active';

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
      if (!project_name) rowErrors.push('project_name required');
      if (!subproject_name) rowErrors.push('subproject_name required');
      if (!['visible', 'hidden'].includes(visibility)) rowErrors.push('visibility must be visible|hidden');
      if (!['active', 'inactive'].includes(status)) rowErrors.push('status must be active|inactive');
      if (isNaN(Number(flatrate))) rowErrors.push('flatrate must be numeric');

      if (rowErrors.length) {
        errors.push({ ...rowOut, errors: rowErrors.join('; ') });
      }

      return rowOut;
    });

    // If parsing produced no rows
    if (normalized.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ error: 'CSV contains no rows' });
    }

    // Now check DB for existing Projects & Subprojects
    // Group by project name for efficient queries
    const projectNames = [...new Set(normalized.map(r => r.project_name.toLowerCase()))];

    // Fetch existing projects
    const existingProjects = await Project.find({ name: { $in: projectNames.map(n => new RegExp(`^${escapeRegex(n)}$`, 'i')) }});
    const projectByName = new Map();
    existingProjects.forEach(p => projectByName.set(p.name.trim().toLowerCase(), p));

    // Built plan
    const plan = []; // each item: {type, row, project, subproject, reason}
    const subprojectChecks = []; // to check existing subprojects for found project ids

    for (const r of normalized) {
      if (errors.find(e => e.__row === r.__row)) {
        plan.push({ type: 'invalid_row', row: r.__row, reason: 'validation failed' });
        continue;
      }

      const pkey = r.project_name.toLowerCase();
      const existingProject = projectByName.get(pkey);

      if (existingProject) {
        // we'll check subproject existence later (need project._id)
        subprojectChecks.push({ row: r, project: existingProject });
      } else {
        // new project would be created
        plan.push({ type: 'create_project', row: r.__row, project_name: r.project_name });
        // and new subproject under it
        plan.push({ type: 'create_subproject', row: r.__row, project_name: r.project_name, subproject_name: r.subproject_name });
      }
    }

    // Check existing subprojects for rows with existing projects
    if (subprojectChecks.length) {
      // group by project id
      const projectIdToRows = new Map();
      for (const item of subprojectChecks) {
        const pid = item.project._id.toString();
        if (!projectIdToRows.has(pid)) projectIdToRows.set(pid, []);
        projectIdToRows.get(pid).push(item.row);
      }

      // For each project, fetch subprojects with those names
      for (const [pid, rowsForProject] of projectIdToRows.entries()) {
        const names = [...new Set(rowsForProject.map(rr => rr.subproject_name))];
        const existingSubs = await Subproject.find({ project_id: pid, name: { $in: names.map(n => new RegExp(`^${escapeRegex(n)}$`, 'i')) }});
        const existingSubsSet = new Set(existingSubs.map(s => s.name.trim().toLowerCase()));

        for (const rr of rowsForProject) {
          if (existingSubsSet.has(rr.subproject_name.toLowerCase())) {
            plan.push({ type: 'skip_existing_subproject', row: rr.__row, project_id: pid, project_name: rr.project_name, subproject_name: rr.subproject_name });
          } else {
            plan.push({ type: 'create_subproject', row: rr.__row, project_id: pid, project_name: rr.project_name, subproject_name: rr.subproject_name });
          }
        }
      }
    }

    // Deduplicate plan items for readability (optional)
    // Build summary
    const summary = {
      totalRows: normalized.length,
      invalidRows: errors.length,
      plannedCreates: plan.filter(p => p.type.startsWith('create')).length,
      plannedSkips: plan.filter(p => p.type.startsWith('skip')).length,
    };

    // If dryRun -> return plan and optionally errors CSV
    if (dryRun) {
      fs.unlinkSync(filePath);

      if (downloadErrors && errors.length) {
        // Return CSV attachment of errors
        const fields = ['__row','project_name','subproject_name','errors'];
        const j2f = new Parser({ fields });
        const csvOut = j2f.parse(errors.map(e => ({ __row: e.__row, project_name: e.project_name, subproject_name: e.subproject_name, errors: e.errors })));
        res.setHeader('Content-Disposition', 'attachment; filename=bulk-upload-errors.csv');
        res.setHeader('Content-Type', 'text/csv');
        return res.send(csvOut);
      }

      return res.json({
        dryRun: true,
        summary,
        errors,    // array of invalid rows with messages
        plan,      // list of actions that WOULD happen (create_project/create_subproject/skip_existing_subproject)
        note: 'No changes were written to the database. To perform the actual import, omit ?dryRun=true',
      });
    }

    // ---------- Not dry run: perform the writes inside a transaction ----------
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Use caches to avoid repeated DB operations
      const projectCache = new Map(); // lowerName -> project doc

      // Pre-fill with existingProjects from earlier
      existingProjects.forEach(p => projectCache.set(p.name.trim().toLowerCase(), p));

      for (const r of normalized) {
        if (errors.find(e => e.__row === r.__row)) {
          // Skip invalid rows; could collect and report later
          continue;
        }

        const pnameKey = r.project_name.toLowerCase();

        let projectDoc = projectCache.get(pnameKey);
        if (!projectDoc) {
          projectDoc = await Project.create([{
            name: r.project_name,
            description: r.project_description || '',
            visibility: r.visibility || 'visible',
            status: r.status || 'active',
            flatrate: Number(r.flatrate) || 0,
          }], { session });
          projectDoc = projectDoc[0];
          projectCache.set(pnameKey, projectDoc);
        }

        // check existing subproject
        const existingSub = await Subproject.findOne({
          name: r.subproject_name,
          project_id: projectDoc._id,
        }).session(session);

        if (!existingSub) {
          await Subproject.create([{
            name: r.subproject_name,
            description: r.subproject_description || '',
            status: r.subproject_status || 'active',
            project_id: projectDoc._id,
          }], { session });
        }
      }

      await session.commitTransaction();
      session.endSession();

      fs.unlinkSync(filePath);
      return res.json({ dryRun: false, message: 'Bulk upload completed', summary: { totalRows: normalized.length } });
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      fs.unlinkSync(filePath);
      console.error('Bulk upload (real run) failed:', err);
      return res.status(500).json({ error: 'Import failed, transaction aborted' });
    }

  } catch (err) {
    console.error('Bulk upload error:', err);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res.status(500).json({ error: 'Failed to process CSV' });
  }
});

// small helper to escape regex special chars for case-insensitive exact match
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
