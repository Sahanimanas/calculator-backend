const express = require('express');
const router = express.Router();
const Productivity = require('../models/SubprojectProductivity');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const AuditLog = require('../models/AuditLog');
// const {   getManagerUser } = require('../middleware/auth');

// ================= GET all productivity tiers =================
router.get('/',   async (req, res) => {
  const { project_id, subproject_id, level } = req.query;
  try {
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;
    if (level) filters.level = level;
    // console.log('Filters:', filters);
    const tiers = await Productivity.find(filters).sort({ created_at: -1 });
    res.json(tiers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET single tier =================
router.get('/:id',   async (req, res) => {
  try {
    const tier = await Productivity.findById(req.params.id);
    if (!tier) return res.status(404).json({ message: 'Productivity tier not found' });
    res.json(tier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE productivity tier =================
router.post('/',   async (req, res) => {
  try {
    const { project_id, subproject_id, level, base_rate, billable_default } = req.body;

    const project = await Project.findById(project_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (subproject_id) {
      const sub = await Subproject.findById(subproject_id);
      if (!sub) return res.status(404).json({ message: 'Subproject not found' });
    }

    const existing = await Productivity.findOne({ project_id, subproject_id, level });
    if (existing) return res.status(400).json({ message: 'Tier already exists' });

    const tier = new Productivity({ project_id, subproject_id, level, base_rate, billable_default });
    await tier.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CREATE',
    //   entity_type: 'Productivity',
    //   entity_id: tier._id,
    //   description: `User ${req.user.email} created productivity tier ${level}`,
    //   details: { level, base_rate, project_id }
    // });

    res.status(201).json(tier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE productivity tier =================
router.put('/:id',   async (req, res) => {
  try {
    const tier = await Productivity.findById(req.params.id);
    if (!tier) return res.status(404).json({ message: 'Productivity tier not found' });

    Object.assign(tier, req.body);
    tier.updated_at = new Date();
    await tier.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'UPDATE',
    //   entity_type: 'Productivity',
    //   entity_id: tier._id,
    //   description: `User ${req.user.email} updated productivity tier ${tier.level}`,
    //   details: req.body
    // });

    res.json(tier);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE productivity tier =================
router.delete('/:id',   async (req, res) => {
  try {
    const tier = await Productivity.findById(req.params.id);
    if (!tier) return res.status(404).json({ message: 'Productivity tier not found' });

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'DELETE',
    //   entity_type: 'Productivity',
    //   entity_id: tier._id,
    //   description: `User ${req.user.email} deleted productivity tier ${tier.level}`,
    //   details: { level: tier.level, base_rate: tier.base_rate }
    // });

    await tier.deleteOne();
    res.json({ message: 'Productivity tier deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CLONE tiers from subproject =================
router.post('/clone-from-subproject',   async (req, res) => {
  try {
    const { source_subproject_id, target_project_id, target_subproject_id } = req.body;

    const source = await Subproject.findById(source_subproject_id);
    if (!source) return res.status(404).json({ message: 'Source subproject not found' });

    const targetProject = await Project.findById(target_project_id);
    if (!targetProject) return res.status(404).json({ message: 'Target project not found' });

    const tiers = await Productivity.find({ subproject_id: source_subproject_id });
    if (!tiers.length) return res.status(400).json({ message: 'No tiers in source subproject' });

    let clonedCount = 0;
    for (const tier of tiers) {
      const exists = await Productivity.findOne({
        project_id: target_project_id,
        subproject_id: target_subproject_id,
        level: tier.level
      });

      if (!exists) {
        const newTier = new Productivity({
          project_id: target_project_id,
          subproject_id: target_subproject_id,
          level: tier.level,
          base_rate: tier.base_rate,
          billable_default: tier.billable_default
        });
        await newTier.save();
        clonedCount++;
      }
    }

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CLONE',
    //   entity_type: 'Productivity',
    //   entity_id: target_project_id,
    //   description: `User ${req.user.email} cloned ${clonedCount} tiers from subproject ${source.name} to project ${targetProject.name}`,
    //   details: { source_subproject: source.name, target_project: targetProject.name, cloned_count: clonedCount }
    // });

    res.json({ message: `Successfully cloned ${clonedCount} tiers`, success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= SUMMARY STATS =================
router.get('/summary/stats',   async (req, res) => {
  try {
    const { project_id } = req.query;
    const filters = {};
    if (project_id) filters.project_id = project_id;

    const tiers = await Productivity.find(filters);
    if (!tiers.length) {
      return {
        total_tiers: 0,
        billable_tiers: 0,
        non_billable_tiers: 0,
        average_rate: 0,
        min_rate: 0,
        max_rate: 0
      };
    }

    const billable = tiers.filter(t => t.billable_default);
    const rates = tiers.map(t => t.base_rate);

    res.json({
      total_tiers: tiers.length,
      billable_tiers: billable.length,
      non_billable_tiers: tiers.length - billable.length,
      average_rate: rates.reduce((a, b) => a + b, 0) / rates.length,
      min_rate: Math.min(...rates),
      max_rate: Math.max(...rates)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= FIXED PRODUCTIVITY LEVELS =================
router.get('/levels/available',   (req, res) => {
  res.json({
    levels: [
      { value: 'Low', label: 'Low', color: 'bg-red-100 text-red-800' },
      { value: 'Medium', label: 'Medium', color: 'bg-yellow-100 text-yellow-800' },
      { value: 'High', label: 'High', color: 'bg-blue-100 text-blue-800' },
      { value: 'Best', label: 'Best', color: 'bg-green-100 text-green-800' }
    ]
  });
});

// ================= CREATE OR UPDATE ALL TIERS =================
router.post('/create_all_tiers',   async (req, res) => {
  try {
    const { projectId, subProjectId, billableByDefault = true, tiers = [] } = req.body;
    if (!projectId || !tiers.length) return res.status(400).json({ message: 'projectId and tiers required' });

    const results = [];
    for (const tier of tiers) {
      const { level, rate } = tier;
      if (!level || rate == null) continue;

      const existing = await Productivity.findOne({
        project_id: projectId,
        subproject_id: subProjectId,
        level
      });

      if (existing) {
        existing.base_rate = rate;
        existing.billable_default = billableByDefault;
        existing.updated_at = new Date();
        await existing.save();
        results.push({ id: existing._id, level, base_rate: existing.base_rate, status: 'updated' });
      } else {
        const newTier = new Productivity({
          project_id: projectId,
          subproject_id: subProjectId,
          level,
          base_rate: rate,
          billable_default: billableByDefault
        });
        await newTier.save();
        results.push({ id: newTier._id, level, base_rate: rate, status: 'created' });
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
