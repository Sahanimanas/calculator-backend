// routes/project.routes.js - UPDATED
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types } = mongoose;
const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const SubProject = require('../models/Subproject');
const SubprojectRequestType = require('../models/SubprojectRequestType');
const SubprojectProductivity = require('../models/SubprojectProductivity');
const Billing = require('../models/Billing');

// ================= STATIC ROUTES FIRST (before any :id routes) =================

// GET all subprojects with PAGINATION
// ?page=1&limit=30&search=keyword&project_id=xxx&client_id=xxx&geography_id=xxx
router.get('/project-subproject', async (req, res) => {
  try {
    const { page, limit, search, project_id, client_id, geography_id } = req.query;
    
    // Build query
    const query = {};
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    if (project_id && Types.ObjectId.isValid(project_id)) {
      query.project_id = new Types.ObjectId(project_id);
    }
    if (client_id && Types.ObjectId.isValid(client_id)) {
      query.client_id = new Types.ObjectId(client_id);
    }
    if (geography_id && Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new Types.ObjectId(geography_id);
    }

    // If pagination params provided, use pagination
    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 30;
      const skip = (pageNum - 1) * limitNum;

      const [subProjects, total] = await Promise.all([
        SubProject.find(query)
          .sort({ created_on: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        SubProject.countDocuments(query)
      ]);

      return res.json({
        data: subProjects,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      });
    }

    // No pagination - return all (backward compatible)
    const subProjects = await SubProject.find(query)
      .sort({ created_on: -1 })
      .lean();
    
    res.json(subProjects);
  } catch (err) {
    console.error('Error fetching all sub-projects:', err);
    res.status(500).json({ message: err.message });
  }
});

// GET all projects with PAGINATION
// ?page=1&limit=30&search=keyword&visibility=visible&client_id=xxx&geography_id=xxx
router.get('/', async (req, res) => {
  try {
    const { visibility, search, page, limit, client_id, geography_id } = req.query;
    
    // Build query
    const query = {};
    if (visibility) query.visibility = visibility;
    if (client_id && Types.ObjectId.isValid(client_id)) {
      query.client_id = new Types.ObjectId(client_id);
    }
    if (geography_id && Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new Types.ObjectId(geography_id);
    }
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // If pagination params provided, use pagination
    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 30;
      const skip = (pageNum - 1) * limitNum;

      const [projects, total] = await Promise.all([
        Project.find(query)
          .sort({ created_on: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        Project.countDocuments(query)
      ]);

      return res.json({
        data: projects,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      });
    }

    // No pagination - return all (backward compatible)
    const projects = await Project.find(query).sort({ created_on: -1 }).lean();
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// GET projects by client (with pagination)
router.get('/client/:clientId', async (req, res) => {
  try {
    const { page = 1, limit = 30, search, status } = req.query;
    const skip = (page - 1) * limit;

    if (!Types.ObjectId.isValid(req.params.clientId)) {
      return res.status(400).json({ error: 'Invalid client ID' });
    }

    // Build query
    const query = { client_id: req.params.clientId };
    if (status) query.status = status;
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const [projects, totalItems] = await Promise.all([
      Project.find(query)
        .sort({ created_on: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Project.countDocuments(query)
    ]);

    // Get subproject counts for each project
    const projectsWithCounts = await Promise.all(
      projects.map(async (project) => {
        const subprojectCount = await SubProject.countDocuments({ 
          project_id: project._id 
        });
        return { ...project, subprojectCount };
      })
    );

    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = page < totalPages;

    res.status(200).json({
      projects: projectsWithCounts,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        itemsPerPage: parseInt(limit),
        hasNextPage,
        hasMore: hasNextPage
      }
    });
  } catch (error) {
    console.error('Error fetching projects by client:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================= SEARCH ENDPOINTS FOR ASYNC DROPDOWNS =================

// Search projects - returns max 30 at a time for dropdown
router.get('/search', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 30, ids, client_id, geography_id } = req.query;
    
    // If specific IDs requested (for pre-populating selected items)
    if (ids) {
      const idArray = ids.split(',').filter(id => Types.ObjectId.isValid(id));
      if (idArray.length === 0) return res.json({ data: [], total: 0 });
      
      const projects = await Project.find({ _id: { $in: idArray } })
        .select('_id name client_id geography_id')
        .lean();
      
      return res.json({ 
        data: projects.map(p => ({ 
          value: p._id, 
          label: p.name,
          client_id: p.client_id,
          geography_id: p.geography_id
        })),
        total: projects.length 
      });
    }

    const query = {};
    if (client_id && Types.ObjectId.isValid(client_id)) {
      query.client_id = new Types.ObjectId(client_id);
    }
    if (geography_id && Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new Types.ObjectId(geography_id);
    }
    if (search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50); // Cap at 50
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(query)
        .select('_id name client_id geography_id')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Project.countDocuments(query)
    ]);

    res.json({
      data: projects.map(p => ({ 
        value: p._id, 
        label: p.name,
        client_id: p.client_id,
        geography_id: p.geography_id
      })),
      total,
      hasMore: skip + projects.length < total
    });

  } catch (err) {
    console.error("Error searching projects:", err);
    res.status(500).json({ message: err.message });
  }
});

// Search subprojects - returns max 30 at a time for dropdown
router.get('/subproject/search', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 30, project_id, client_id, geography_id, ids } = req.query;
    
    // If specific IDs requested
    if (ids) {
      const idArray = ids.split(',').filter(id => Types.ObjectId.isValid(id));
      if (idArray.length === 0) return res.json({ data: [], total: 0 });
      
      const subprojects = await SubProject.find({ _id: { $in: idArray } })
        .select('_id name project_id client_id geography_id')
        .lean();
      
      return res.json({ 
        data: subprojects.map(sp => ({ 
          value: sp._id, 
          label: sp.name,
          project_id: sp.project_id,
          client_id: sp.client_id,
          geography_id: sp.geography_id
        })),
        total: subprojects.length 
      });
    }

    const query = {};
    
    // Filter by hierarchy
    if (geography_id && Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new Types.ObjectId(geography_id);
    }
    if (client_id && Types.ObjectId.isValid(client_id)) {
      query.client_id = new Types.ObjectId(client_id);
    }
    if (project_id && Types.ObjectId.isValid(project_id)) {
      query.project_id = new Types.ObjectId(project_id);
    }
    
    if (search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);
    const skip = (pageNum - 1) * limitNum;

    const [subprojects, total] = await Promise.all([
      SubProject.find(query)
        .select('_id name project_id client_id geography_id flatrate')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      SubProject.countDocuments(query)
    ]);

    res.json({
      data: subprojects.map(sp => ({ 
        value: sp._id, 
        label: sp.name,
        project_id: sp.project_id,
        client_id: sp.client_id,
        geography_id: sp.geography_id,
        flatrate: sp.flatrate
      })),
      total,
      hasMore: skip + subprojects.length < total
    });

  } catch (err) {
    console.error("Error searching subprojects:", err);
    res.status(500).json({ message: err.message });
  }
});

// GET projects with totals (paginated)
router.get('/projects-with-totals', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;
    const { search, client_id, geography_id } = req.query;

    // Build query
    const query = {};
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    if (client_id && Types.ObjectId.isValid(client_id)) {
      query.client_id = new Types.ObjectId(client_id);
    }
    if (geography_id && Types.ObjectId.isValid(geography_id)) {
      query.geography_id = new Types.ObjectId(geography_id);
    }

    const totalProjects = await Project.countDocuments(query);

    if (totalProjects === 0) {
      return res.json({ projects: [], pagination: { totalItems: 0 } });
    }

    // If explicitly requesting all (for backward compatibility)
    if (req.query.all === 'true') {
      limit = totalProjects;
    }

    const projects = await Project.find(query)
      .skip(skip)
      .limit(limit)
      .sort({ created_on: -1 })
      .lean();

    const projectIds = projects.map(p => p._id);

    const [subprojectTotals, requestTypeTotals] = await Promise.all([
      SubProject.aggregate([
        { $match: { project_id: { $in: projectIds } } },
        {
          $group: {
            _id: '$project_id',
            totalFlatrate: { $sum: '$flatrate' },
            subprojectCount: { $sum: 1 }
          }
        }
      ]),
      SubprojectRequestType.aggregate([
        { $match: { project_id: { $in: projectIds } } },
        {
          $group: {
            _id: '$project_id',
            totalRequestRates: { $sum: '$rate' }
          }
        }
      ])
    ]);

    const subMap = {};
    subprojectTotals.forEach(item => {
      subMap[item._id.toString()] = item;
    });

    const reqMap = {};
    requestTypeTotals.forEach(item => {
      reqMap[item._id.toString()] = item;
    });

    const result = projects.map(project => {
      const pId = project._id.toString();
      const spData = subMap[pId] || { totalFlatrate: 0, subprojectCount: 0 };
      const reqData = reqMap[pId] || { totalRequestRates: 0 };
      const totalRate = reqData.totalRequestRates;

      return {
        _id: project._id,
        name: project.name,
        description: project.description,
        visibility: project.visibility,
        status: project.status,
        geography_id: project.geography_id,
        geography_name: project.geography_name,
        client_id: project.client_id,
        client_name: project.client_name,
        created_on: project.created_on,
        subprojectCount: spData.subprojectCount,
        totalFlatrate: spData.totalFlatrate,
        totalRate: totalRate
      };
    });

    res.json({
      projects: result,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalProjects / limit),
        totalItems: totalProjects,
        itemsPerPage: limit,
        hasNextPage: page < Math.ceil(totalProjects / limit),
        hasPrevPage: page > 1
      }
    });
  } catch (err) {
    console.error('Error fetching projects with totals:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= POST ROUTES =================

// CREATE project
router.post('/', async (req, res) => {
  try {
    const { name, description, visibility, status, geography_id, client_id } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Project name is required' });
    }

    if (!geography_id) {
      return res.status(400).json({ message: 'Geography is required' });
    }

    if (!client_id) {
      return res.status(400).json({ message: 'Client is required' });
    }

    // Verify geography exists
    const geography = await Geography.findById(geography_id);
    if (!geography) {
      return res.status(404).json({ message: 'Geography not found' });
    }

    // Verify client exists
    const client = await Client.findById(client_id);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Check for duplicate name within the same client
    const normalizedName = name.trim().toLowerCase();
    const existingProject = await Project.findOne({
      client_id,
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') }
    });

    if (existingProject) {
      return res.status(409).json({ 
        message: `Project with this name already exists for client "${client.name}"` 
      });
    }

    const project = new Project({
      name: name.trim(),
      description: description?.trim() || '',
      visibility: visibility || 'visible',
      status: status || 'active',
      geography_id,
      geography_name: geography.name,
      client_id,
      client_name: client.name
    });

    await project.save();
    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// CREATE sub-project (location)
router.post('/subproject', async (req, res) => {
  try {
    const { 
      project_id, 
      client_id, 
      geography_id, 
      name, 
      description, 
      status,
      flatrate 
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Location name is required' });
    }

    if (!geography_id) {
      return res.status(400).json({ message: 'Geography is required' });
    }

    if (!client_id) {
      return res.status(400).json({ message: 'Client is required' });
    }

    if (!project_id) {
      return res.status(400).json({ message: 'Project is required' });
    }

    // Verify hierarchy exists
    const [geography, client, project] = await Promise.all([
      Geography.findById(geography_id),
      Client.findById(client_id),
      Project.findById(project_id)
    ]);

    if (!geography) {
      return res.status(404).json({ message: 'Geography not found' });
    }

    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Check for duplicate name within the same project
    const normalizedName = name.trim().toLowerCase();
    const existingSubProject = await SubProject.findOne({
      project_id,
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') }
    });

    if (existingSubProject) {
      return res.status(409).json({ 
        message: `Location with this name already exists under project "${project.name}"` 
      });
    }

    const subProject = new SubProject({
      name: name.trim(),
      description: description?.trim() || '',
      status: status || 'active',
      project_id,
      project_name: project.name,
      client_id,
      client_name: client.name,
      geography_id,
      geography_name: geography.name,
      flatrate: parseFloat(flatrate) || 0
    });

    await subProject.save();
    res.status(201).json(subProject);
  } catch (err) {
    console.error('Error creating sub-project:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// CREATE request type for subproject
router.post('/subproject/:subprojectId/request-type', async (req, res) => {
  try {
    const { subprojectId } = req.params;
    const { name, rate, project_id, client_id, geography_id } = req.body;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    // Verify subproject exists
    const subproject = await SubProject.findById(subprojectId);
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    // Check if request type already exists for this subproject
    const existingRequestType = await SubprojectRequestType.findOne({
      subproject_id: subprojectId,
      name: name
    });

    if (existingRequestType) {
      return res.status(409).json({ 
        message: `Request type "${name}" already exists for this location` 
      });
    }

    const requestType = new SubprojectRequestType({
      subproject_id: subprojectId,
      project_id: project_id || subproject.project_id,
      client_id: client_id || subproject.client_id,
      geography_id: geography_id || subproject.geography_id,
      name,
      rate: parseFloat(rate) || 0
    });

    await requestType.save();
    res.status(201).json(requestType);
  } catch (err) {
    console.error('Error creating request type:', err);
    if (err.code === 11000) {
      return res.status(409).json({ 
        message: 'Request type already exists for this location' 
      });
    }
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// ================= PUT ROUTES (with static paths first) =================

// UPDATE sub-project (static path /subproject/:id)
router.put('/subproject/:id', async (req, res) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subProject = await SubProject.findById(req.params.id);
    if (!subProject) {
      return res.status(404).json({ message: 'Sub-project not found' });
    }

    const { 
      name, 
      project_id, 
      client_id, 
      geography_id, 
      status, 
      description, 
      flatrate 
    } = req.body;

    // If hierarchy is being updated, verify entities exist
    if (geography_id && geography_id !== subProject.geography_id.toString()) {
      const geography = await Geography.findById(geography_id);
      if (!geography) {
        return res.status(404).json({ message: 'Geography not found' });
      }
      subProject.geography_id = geography_id;
      subProject.geography_name = geography.name;
    }

    if (client_id && client_id !== subProject.client_id.toString()) {
      const client = await Client.findById(client_id);
      if (!client) {
        return res.status(404).json({ message: 'Client not found' });
      }
      subProject.client_id = client_id;
      subProject.client_name = client.name;
    }

    if (project_id && project_id !== subProject.project_id.toString()) {
      const project = await Project.findById(project_id);
      if (!project) {
        return res.status(404).json({ message: 'Project not found' });
      }
      subProject.project_id = project_id;
      subProject.project_name = project.name;
    }

    if (name) subProject.name = name.trim();
    if (status) subProject.status = status;
    if (description !== undefined) subProject.description = description.trim();
    if (flatrate !== undefined) subProject.flatrate = parseFloat(flatrate);

    await subProject.save();
    res.json(subProject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE request type
router.put('/subproject/:subprojectId/request-type/:requestTypeId', async (req, res) => {
  try {
    const { subprojectId, requestTypeId } = req.params;
    const { rate } = req.body;

    if (!Types.ObjectId.isValid(subprojectId) || !Types.ObjectId.isValid(requestTypeId)) {
      return res.status(400).json({ message: 'Invalid ID' });
    }

    const requestType = await SubprojectRequestType.findOne({
      _id: requestTypeId,
      subproject_id: subprojectId
    });

    if (!requestType) {
      return res.status(404).json({ message: 'Request type not found' });
    }

    if (rate !== undefined) {
      requestType.rate = parseFloat(rate);
    }

    await requestType.save();
    res.json(requestType);
  } catch (err) {
    console.error('Error updating request type:', err);
    res.status(500).json({ message: err.message });
  }
});

// UPDATE project (dynamic path /:id)
router.put('/:id', async (req, res) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(req.params.id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const { 
      name, 
      description, 
      visibility, 
      status, 
      geography_id, 
      client_id 
    } = req.body;

    // If geography is being updated, verify it exists
    if (geography_id && geography_id !== project.geography_id.toString()) {
      const geography = await Geography.findById(geography_id);
      if (!geography) {
        return res.status(404).json({ message: 'Geography not found' });
      }
      project.geography_id = geography_id;
      project.geography_name = geography.name;
    }

    // If client is being updated, verify it exists
    if (client_id && client_id !== project.client_id.toString()) {
      const client = await Client.findById(client_id);
      if (!client) {
        return res.status(404).json({ message: 'Client not found' });
      }
      project.client_id = client_id;
      project.client_name = client.name;
    }

    if (name) project.name = name.trim();
    if (description !== undefined) project.description = description.trim();
    if (visibility) project.visibility = visibility;
    if (status) project.status = status;

    await project.save();

    // Update denormalized data in subprojects if hierarchy changed
    if (geography_id || client_id || name) {
      const updateData = {};
      if (geography_id) {
        updateData.geography_id = project.geography_id;
        updateData.geography_name = project.geography_name;
      }
      if (client_id) {
        updateData.client_id = project.client_id;
        updateData.client_name = project.client_name;
      }
      if (name) {
        updateData.project_name = project.name;
      }

      await SubProject.updateMany(
        { project_id: project._id },
        { $set: updateData }
      );
    }

    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE ROUTES (with static paths first) =================

// DELETE sub-project
router.delete('/subproject/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subProject = await SubProject.findById(req.params.id).session(session);
    if (!subProject) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Sub-project not found' });
    }

    // Delete related data
    await SubprojectRequestType.deleteMany({ subproject_id: subProject._id }, { session });
    await SubprojectProductivity.deleteMany({ subproject_id: subProject._id }, { session });
    await Billing.deleteMany({ subproject_id: subProject._id }, { session });
    await subProject.deleteOne({ session });

    await session.commitTransaction();
    session.endSession();
    res.status(200).json({ 
      message: 'Sub-project and its data deleted successfully', 
      success: true 
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE project
router.delete('/:id', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(req.params.id).session(session);
    if (!project) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Project not found' });
    }

    // Get all subprojects
    const subprojects = await SubProject.find({ project_id: project._id }).session(session);
    const subprojectIds = subprojects.map(sp => sp._id);

    // Delete all related data
    await SubprojectRequestType.deleteMany({ project_id: project._id }, { session });
    await SubprojectProductivity.deleteMany({ project_id: project._id }, { session });
    await Billing.deleteMany({ project_id: project._id }, { session });
    await SubProject.deleteMany({ project_id: project._id }, { session });
    await project.deleteOne({ session });

    await session.commitTransaction();
    session.endSession();
    res.status(200).json({ 
      message: 'Project and all associated data deleted successfully', 
      success: true 
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DYNAMIC GET ROUTES (MUST BE LAST) =================

// GET sub-projects for a specific project with PAGINATION
router.get('/:project_id/subproject', async (req, res) => {
  try {
    const { project_id } = req.params;
    const { page, limit, search } = req.query;

    if (!Types.ObjectId.isValid(project_id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(project_id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // Build query
    const query = { project_id: new Types.ObjectId(project_id) };
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // If pagination params provided
    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 30;
      const skip = (pageNum - 1) * limitNum;

      const [subProjects, total] = await Promise.all([
        SubProject.find(query)
          .sort({ created_on: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean(),
        SubProject.countDocuments(query)
      ]);

      // Fetch request types for the subprojects
      const subProjectIds = subProjects.map(sp => sp._id);
      const requestTypes = await SubprojectRequestType.find({
        subproject_id: { $in: subProjectIds }
      }).lean();

      const subProjectsWithRates = subProjects.map(sp => {
        const typesForThisSp = requestTypes.filter(
          rt => rt.subproject_id.toString() === sp._id.toString()
        );
        return {
          ...sp,
          request_types: typesForThisSp.map(rt => ({
            name: rt.name,
            rate: rt.rate,
            _id: rt._id
          }))
        };
      });

      return res.json({
        data: subProjectsWithRates,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      });
    }

    // No pagination - return all (backward compatible)
    const subProjects = await SubProject.find(query)
      .sort({ created_on: -1 })
      .lean();

    if (subProjects.length === 0) {
      return res.json([]);
    }

    const subProjectIds = subProjects.map(sp => sp._id);

    const requestTypes = await SubprojectRequestType.find({
      subproject_id: { $in: subProjectIds }
    }).lean();

    const subProjectsWithRates = subProjects.map(sp => {
      const typesForThisSp = requestTypes.filter(
        rt => rt.subproject_id.toString() === sp._id.toString()
      );

      return {
        ...sp,
        request_types: typesForThisSp.map(rt => ({
          name: rt.name,
          rate: rt.rate,
          _id: rt._id
        }))
      };
    });

    res.json(subProjectsWithRates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// GET single project - MUST BE ABSOLUTELY LAST
router.get('/:id', async (req, res) => {
  try {
    if (!Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(req.params.id)
      .populate('geography_id', 'name')
      .populate('client_id', 'name');
      
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;