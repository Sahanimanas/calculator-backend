const express = require('express');
const router = express.Router();
const RequestType = require('../models/SubprojectRequestType');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const AuditLog = require('../models/AuditLog');
// const { getManagerUser } = require('../middleware/auth');

// ================= GET all request types =================
router.get('/', async (req, res) => {
  const { project_id, subproject_id, name } = req.query;
  try {
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;
    if (name) filters.name = name;

    const requestTypes = await RequestType.find(filters).sort({ created_at: -1 });
    
    if (!requestTypes.length) {
      return res.json([]);
    }
    res.json(requestTypes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET single request type =================
router.get('/:id', async (req, res) => {
  try {
    const requestType = await RequestType.findById(req.params.id);
    if (!requestType) return res.status(404).json({ message: 'Request type not found' });
    res.json(requestType);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE request type =================
router.post('/', async (req, res) => {
  try {
    const { project_id, subproject_id, name, rate } = req.body;

    const project = await Project.findById(project_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    if (subproject_id) {
      const sub = await Subproject.findById(subproject_id);
      if (!sub) return res.status(404).json({ message: 'Subproject not found' });
    }

    // Check for duplicates based on Schema index (subproject_id + name must be unique)
    const existing = await RequestType.findOne({ subproject_id, name });
    if (existing) return res.status(400).json({ message: 'Request type already exists for this subproject' });

    const requestType = new RequestType({ project_id, subproject_id, name, rate });
    await requestType.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CREATE',
    //   entity_type: 'RequestType',
    //   entity_id: requestType._id,
    //   description: `User ${req.user.email} created request type ${name}`,
    //   details: { name, rate, project_id }
    // });

    res.status(201).json(requestType);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE request type =================
router.put('/:id', async (req, res) => {
  try {
    const requestType = await RequestType.findById(req.params.id);
    if (!requestType) return res.status(404).json({ message: 'Request type not found' });

    Object.assign(requestType, req.body);
    // Mongoose timestamps handle updatedAt automatically, but setting explicitly if needed:
    // requestType.updatedAt = new Date(); 
    
    await requestType.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'UPDATE',
    //   entity_type: 'RequestType',
    //   entity_id: requestType._id,
    //   description: `User ${req.user.email} updated request type ${requestType.name}`,
    //   details: req.body
    // });

    res.json(requestType);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE request type =================
router.delete('/:id', async (req, res) => {
  try {
    const requestType = await RequestType.findById(req.params.id);
    if (!requestType) return res.status(404).json({ message: 'Request type not found' });

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'DELETE',
    //   entity_type: 'RequestType',
    //   entity_id: requestType._id,
    //   description: `User ${req.user.email} deleted request type ${requestType.name}`,
    //   details: { name: requestType.name, rate: requestType.rate }
    // });

    await requestType.deleteOne();
    res.json({ message: 'Request type deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CLONE request types from subproject =================
router.post('/clone-from-subproject', async (req, res) => {
  try {
    const { source_subproject_id, target_project_id, target_subproject_id } = req.body;

    const source = await Subproject.findById(source_subproject_id);
    if (!source) return res.status(404).json({ message: 'Source subproject not found' });

    const targetProject = await Project.findById(target_project_id);
    if (!targetProject) return res.status(404).json({ message: 'Target project not found' });

    const sourceTypes = await RequestType.find({ subproject_id: source_subproject_id });
    if (!sourceTypes.length) return res.status(400).json({ message: 'No request types in source subproject' });

    let clonedCount = 0;
    for (const type of sourceTypes) {
      const exists = await RequestType.findOne({
        subproject_id: target_subproject_id,
        name: type.name
      });

      if (!exists) {
        const newType = new RequestType({
          project_id: target_project_id,
          subproject_id: target_subproject_id,
          name: type.name,
          rate: type.rate
        });
        await newType.save();
        clonedCount++;
      }
    }

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CLONE',
    //   entity_type: 'RequestType',
    //   entity_id: target_project_id,
    //   description: `User ${req.user.email} cloned ${clonedCount} request types`,
    //   details: { source_subproject: source.name, cloned_count: clonedCount }
    // });

    res.json({ message: `Successfully cloned ${clonedCount} request types`, success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= SUMMARY STATS =================
router.get('/summary/stats', async (req, res) => {
  try {
    const { project_id, subproject_id } = req.query;
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;

    const types = await RequestType.find(filters);
    
    if (!types.length) {
      return res.json({
        total_types: 0,
        average_rate: 0,
        min_rate: 0,
        max_rate: 0
      });
    }

    const rates = types.map(t => t.rate);

    res.json({
      total_types: types.length,
      average_rate: rates.reduce((a, b) => a + b, 0) / rates.length,
      min_rate: Math.min(...rates),
      max_rate: Math.max(...rates)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= AVAILABLE REQUEST TYPES =================
router.get('/types/available', (req, res) => {
  // Returns the allowed Enum values defined in the Schema
  res.json({
    types: [
      { value: 'Duplicate', label: 'Duplicate', color: 'bg-gray-100 text-gray-800' },
      { value: 'Key', label: 'Key', color: 'bg-blue-100 text-blue-800' },
      { value: 'New Request', label: 'New Request', color: 'bg-green-100 text-green-800' }
    ]
  });
});

// ================= CREATE OR UPDATE ALL TYPES =================
router.post('/create_all_types', async (req, res) => {
  try {
    // Expects "types" array containing objects with { name, rate }
    const { projectId, subProjectId, types = [] } = req.body;
    
    if (!projectId || !subProjectId || !types.length) {
      return res.status(400).json({ message: 'projectId, subProjectId, and types array required' });
    }

    const results = [];
    for (const typeItem of types) {
      const { name, rate } = typeItem;
      if (!name || rate == null) continue;

      const existing = await RequestType.findOne({
        project_id: projectId,
        subproject_id: subProjectId,
        name
      });

      if (existing) {
        existing.rate = rate;
        // existing.updatedAt = new Date();
        await existing.save();
        results.push({ id: existing._id, name, rate: existing.rate, status: 'updated' });
      } else {
        const newType = new RequestType({
          project_id: projectId,
          subproject_id: subProjectId,
          name,
          rate
        });
        await newType.save();
        results.push({ id: newType._id, name, rate, status: 'created' });
      }
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;