const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Subproject = require('../models/Subproject.js');
const SubprojectProductivity = require('../models//SubprojectProductivity');
const Project = require('../models/Project');


router.post('/', async (req, res) => {
  try {
    const { project_id, subproject_id, tiers } = req.body;

    // Validate IDs
    if (!project_id || !mongoose.Types.ObjectId.isValid(project_id)) {
      return res.status(400).json({ message: 'Invalid or missing project_id' });
    }

    if (!subproject_id || !mongoose.Types.ObjectId.isValid(subproject_id)) {
      return res.status(400).json({ message: 'Invalid or missing subproject_id' });
    }

    // Validate tiers object
    if (!tiers || typeof tiers !== 'object' || Object.keys(tiers).length === 0) {
      return res.status(400).json({ message: 'Tiers must be a non-empty object' });
    }

    // Verify subproject exists
    const subproject = await Subproject.findById(subproject_id).populate('project_id');
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    // Clean old tiers (optional)
    await SubprojectProductivity.deleteMany({ subproject_id });

    // Build new tier documents
    const validLevels = ['low', 'medium', 'high', 'best'];
    const newTiers = Object.entries(tiers)
      .filter(([level, base_rate]) => validLevels.includes(level))
      .map(([level, base_rate]) => ({
        project_id,
        subproject_id,
        level,
        base_rate: Number(base_rate)
      }));

    if (newTiers.length === 0) {
      return res.status(400).json({ message: 'No valid productivity tiers provided' });
    }

    // Insert all new tiers
    const savedTiers = await SubprojectProductivity.insertMany(newTiers);

    res.status(201).json({
      message: 'Productivity tiers updated successfully',
      project_id,
      subproject: subproject.name,
      tiers: savedTiers
    });
  } catch (err) {
    console.error('Error creating productivity tiers:', err);
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/subproject-productivity/:subproject_id
 * Fetch all productivity tiers for a subproject
 */


router.get('/tiers', async (req, res) => {
  try {
    // Fetch all productivity data with populated project & subproject names
    const data = await SubprojectProductivity.find()
      .populate('project_id', 'name')
      .populate('subproject_id', 'name')
      .lean();

    if (!data || data.length === 0) {
      return res.status(404).json({ message: 'No productivity tiers found' });
    }

    // Filter out items with missing project or subproject
    const filteredData = data.filter(item => item.project_id && item.subproject_id);

    // Transform data into dummyTiersData-like format
    const formatted = filteredData.map((item, index) => ({
      id: index + 1,
      project: item.project_id.name,
      project_id: item.project_id._id,
      subproject_id: item.subproject_id._id,
      subProject: item.subproject_id.name,
      level: item.level.charAt(0).toUpperCase() + item.level.slice(1),
      rate: item.base_rate ?? 0
    }));

    res.status(200).json(formatted);
  } catch (err) {
    console.error('Error fetching productivity data:', err);
    res.status(500).json({ message: err.message });
  }
});


router.get('/tiers/:subproject_id', async (req, res) => {
  try {
    const { subproject_id } = req.params;


    const tiers = await SubprojectProductivity
      .find({ subproject_id }) // ✅ correct: query by field, not _id
      .sort({ level: 1 });

    res.json(tiers);
  } catch (err) {
    console.error('Error fetching productivity tiers:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
