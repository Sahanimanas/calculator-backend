// routes/project.routes.js - COMPLETE FILE with Requestor Types for MRO
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { Types } = mongoose;
const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const SubProject = require('../models/Subproject');
const SubprojectRequestType = require('../models/SubprojectRequestType');
const SubprojectRequestorType = require('../models/SubprojectRequestorType');

// ================= GET all projects =================
router.get('/', async (req, res) => {
  try {
    const { page, limit, search, visibility, status
    } = req.query;

    const query = {};
    
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }
    if (visibility) query.visibility = visibility;
    if (status) query.status = status;

    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 30;
      const skip = (pageNum - 1) * limitNum;

      const [projects, total] = await Promise.all([
        Project.find(query).sort({ created_on: -1 }).skip(skip).limit(limitNum).lean(),
        Project.countDocuments(query)
      ]);

      return res.json({
        projects,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      });
    }

    const projects = await Project.find(query).sort({ created_on: -1 }).lean();
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET projects by client =================
router.get('/client/:client_id', async (req, res) => {
  try {
    const { client_id } = req.params;
    const { page, limit, search } = req.query;

    if (!Types.ObjectId.isValid(client_id)) {
      return res.status(400).json({ message: 'Invalid client ID' });
    }

    const query = { client_id: new Types.ObjectId(client_id) };
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    if (page || limit) {
      const pageNum = parseInt(page) || 1;
      const limitNum = parseInt(limit) || 30;
      const skip = (pageNum - 1) * limitNum;

      const [projects, total] = await Promise.all([
        Project.find(query).sort({ created_on: -1 }).skip(skip).limit(limitNum).lean(),
        Project.countDocuments(query)
      ]);

      // Get subproject counts
      const projectIds = projects.map(p => p._id);
      const subprojectCounts = await SubProject.aggregate([
        { $match: { project_id: { $in: projectIds } } },
        { $group: { _id: '$project_id', count: { $sum: 1 } } }
      ]);

      const countMap = {};
      subprojectCounts.forEach(item => {
        countMap[item._id.toString()] = item.count;
      });

      const projectsWithCounts = projects.map(p => ({
        ...p,
        subprojectCount: countMap[p._id.toString()] || 0
      }));

      return res.json({
        projects: projectsWithCounts,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(total / limitNum),
          totalItems: total,
          itemsPerPage: limitNum,
          hasMore: pageNum < Math.ceil(total / limitNum)
        }
      });
    }

    const projects = await Project.find(query).sort({ created_on: -1 }).lean();
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET project by ID =================
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(id).lean();
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE project =================
router.post('/', async (req, res) => {
  try {
    const { name, description, client_id, status, visibility } = req.body;

    if (!name || !client_id) {
      return res.status(400).json({ message: 'Name and client_id are required' });
    }

    if (!Types.ObjectId.isValid(client_id)) {
      return res.status(400).json({ message: 'Invalid client ID' });
    }

    const client = await Client.findById(client_id);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const project = new Project({
      name,
      description,
      client_id: client._id,
      client_name: client.name,
      geography_id: client.geography_id,
      geography_name: client.geography_name,
      status: status || 'active',
      visibility: visibility || 'visible'
    });

    await project.save();
    res.status(201).json(project);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Project with this name already exists for this client' });
    }
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE project =================
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status, visibility } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    if (name) project.name = name;
    if (description !== undefined) project.description = description;
    if (status) project.status = status;
    if (visibility) project.visibility = visibility;

    await project.save();
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE project =================
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    // Delete all related data
    const subprojects = await SubProject.find({ project_id: id }).lean();
    const subprojectIds = subprojects.map(sp => sp._id);

    if (subprojectIds.length > 0) {
      await SubprojectRequestType.deleteMany({ subproject_id: { $in: subprojectIds } });
      try {
        await SubprojectRequestorType.deleteMany({ subproject_id: { $in: subprojectIds } });
      } catch (e) {
        // Model might not exist
      }
    }

    await SubProject.deleteMany({ project_id: id });
    await Project.findByIdAndDelete(id);

    res.json({ message: 'Project and all related data deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// =================================================================================
// SUBPROJECT ROUTES
// =================================================================================

// ================= GET sub-projects with Request Types AND Requestor Types =================
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

    // Check if this is an MRO client
    const client = await Client.findById(project.client_id);
    const isMRO = client?.name?.toLowerCase() === 'mro';

    // Build query
    const query = { project_id: new Types.ObjectId(project_id) };
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // Helper function to process subprojects
    const processSubprojects = async (subProjects) => {
      if (subProjects.length === 0) return [];

      const subProjectIds = subProjects.map(sp => sp._id);
      
      // Fetch request types
      const requestTypes = await SubprojectRequestType.find({
        subproject_id: { $in: subProjectIds }
      }).lean();

      // Fetch requestor types (for MRO)
      let requestorTypes = [];
      if (isMRO) {
        try {
          requestorTypes = await SubprojectRequestorType.find({
            subproject_id: { $in: subProjectIds }
          }).lean();
        } catch (e) {
          console.log('SubprojectRequestorType collection not found');
        }
      }

      return subProjects.map(sp => {
        const typesForThisSp = requestTypes.filter(
          rt => rt.subproject_id.toString() === sp._id.toString()
        );
        const requestorTypesForThisSp = requestorTypes.filter(
          rt => rt.subproject_id.toString() === sp._id.toString()
        );

        // Build response object - rename flatrate to rate
        const result = {
          _id: sp._id,
          name: sp.name,
          description: sp.description,
          status: sp.status,
          project_id: sp.project_id,
          project_name: sp.project_name,
          client_id: sp.client_id,
          client_name: sp.client_name,
          geography_id: sp.geography_id,
          geography_name: sp.geography_name,
          rate: sp.flatrate || 0,  // Renamed from flatrate to rate
          created_on: sp.created_on,
          updated_at: sp.updated_at,
          __v: sp.__v,
          request_types: typesForThisSp.map(rt => ({
            name: rt.name,
            rate: rt.rate,
            _id: rt._id
          })),
          isMRO
        };

        // Add requestor_types for MRO
        if (isMRO) {
          result.requestor_types = requestorTypesForThisSp.map(rt => ({
            name: rt.name,
            rate: rt.rate,
            _id: rt._id
          }));
        }

        return result;
      });
    };

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

      const subProjectsWithRates = await processSubprojects(subProjects);

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

    // No pagination - return all
    const subProjects = await SubProject.find(query)
      .sort({ created_on: -1 })
      .lean();

    const subProjectsWithRates = await processSubprojects(subProjects);
    res.json(subProjectsWithRates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET single subproject =================
router.get('/subproject/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subproject = await SubProject.findById(id).lean();
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    // Check if MRO
    const client = await Client.findById(subproject.client_id);
    const isMRO = client?.name?.toLowerCase() === 'mro';

    // Get request types
    const requestTypes = await SubprojectRequestType.find({
      subproject_id: id
    }).lean();

    // Get requestor types for MRO
    let requestorTypes = [];
    if (isMRO) {
      try {
        requestorTypes = await SubprojectRequestorType.find({
          subproject_id: id
        }).lean();
      } catch (e) {}
    }

    const result = {
      ...subproject,
      rate: subproject.flatrate || 0,  // Renamed
      request_types: requestTypes.map(rt => ({
        name: rt.name,
        rate: rt.rate,
        _id: rt._id
      })),
      isMRO
    };

    if (isMRO) {
      result.requestor_types = requestorTypes.map(rt => ({
        name: rt.name,
        rate: rt.rate,
        _id: rt._id
      }));
    }

    // Remove old flatrate field
    delete result.flatrate;

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE subproject =================
router.post('/subproject', async (req, res) => {
  try {
    const { 
      name, 
      description, 
      project_id, 
      status, 
      rate,  // Accept rate instead of flatrate
      flatrate,  // Also accept flatrate for backward compatibility
      request_types 
    } = req.body;

    if (!name || !project_id) {
      return res.status(400).json({ message: 'Name and project_id are required' });
    }

    if (!Types.ObjectId.isValid(project_id)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const project = await Project.findById(project_id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const subproject = new SubProject({
      name,
      description,
      project_id: project._id,
      project_name: project.name,
      client_id: project.client_id,
      client_name: project.client_name,
      geography_id: project.geography_id,
      geography_name: project.geography_name,
      status: status || 'active',
      flatrate: rate || flatrate || 0  // Store as flatrate internally
    });

    await subproject.save();

    // Create request types if provided
    if (request_types && Array.isArray(request_types)) {
      const requestTypeDocs = request_types.map(rt => ({
        subproject_id: subproject._id,
        project_id: project._id,
        client_id: project.client_id,
        geography_id: project.geography_id,
        name: rt.name,
        rate: rt.rate || 0
      }));

      await SubprojectRequestType.insertMany(requestTypeDocs, { ordered: false });
    }

    // Return with rate instead of flatrate
    const result = subproject.toObject();
    result.rate = result.flatrate;
    delete result.flatrate;

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Location with this name already exists for this project' });
    }
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE subproject =================
router.put('/subproject/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, status, rate, flatrate } = req.body;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subproject = await SubProject.findById(id);
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    if (name) subproject.name = name;
    if (description !== undefined) subproject.description = description;
    if (status) subproject.status = status;
    if (rate !== undefined) subproject.flatrate = rate;  // Accept rate, store as flatrate
    if (flatrate !== undefined) subproject.flatrate = flatrate;  // Backward compat

    await subproject.save();

    // Return with rate
    const result = subproject.toObject();
    result.rate = result.flatrate;
    delete result.flatrate;

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE subproject =================
router.delete('/subproject/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    // Delete related request types
    await SubprojectRequestType.deleteMany({ subproject_id: id });
    
    // Delete related requestor types
    try {
      await SubprojectRequestorType.deleteMany({ subproject_id: id });
    } catch (e) {}

    await SubProject.findByIdAndDelete(id);

    res.json({ message: 'Location deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// =================================================================================
// REQUEST TYPE ROUTES
// =================================================================================

// GET request types for a subproject
router.get('/subproject/:subprojectId/request-types', async (req, res) => {
  try {
    const { subprojectId } = req.params;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const requestTypes = await SubprojectRequestType.find({
      subproject_id: subprojectId
    }).lean();

    res.json(requestTypes);
  } catch (err) {
    console.error('Error fetching request types:', err);
    res.status(500).json({ message: err.message });
  }
});

// CREATE request type
router.post('/subproject/:subprojectId/request-type', async (req, res) => {
  try {
    const { subprojectId } = req.params;
    const { name, rate } = req.body;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subproject = await SubProject.findById(subprojectId);
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    const requestType = new SubprojectRequestType({
      subproject_id: subprojectId,
      project_id: subproject.project_id,
      client_id: subproject.client_id,
      geography_id: subproject.geography_id,
      name,
      rate: parseFloat(rate) || 0
    });

    await requestType.save();
    res.status(201).json(requestType);
  } catch (err) {
    console.error('Error creating request type:', err);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Request type already exists' });
    }
    res.status(500).json({ message: err.message });
  }
});

// UPDATE request type
router.put('/subproject/:subprojectId/request-type/:requestTypeId', async (req, res) => {
  try {
    const { subprojectId, requestTypeId } = req.params;
    const { rate } = req.body;

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

// DELETE request type
router.delete('/subproject/:subprojectId/request-type/:requestTypeId', async (req, res) => {
  try {
    const { subprojectId, requestTypeId } = req.params;

    const result = await SubprojectRequestType.deleteOne({
      _id: requestTypeId,
      subproject_id: subprojectId
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Request type not found' });
    }

    res.json({ message: 'Request type deleted successfully' });
  } catch (err) {
    console.error('Error deleting request type:', err);
    res.status(500).json({ message: err.message });
  }
});

// =================================================================================
// REQUESTOR TYPE ROUTES (MRO specific)
// =================================================================================

// GET requestor types for a subproject
router.get('/subproject/:subprojectId/requestor-types', async (req, res) => {
  try {
    const { subprojectId } = req.params;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const requestorTypes = await SubprojectRequestorType.find({
      subproject_id: subprojectId
    }).lean();

    res.json(requestorTypes);
  } catch (err) {
    console.error('Error fetching requestor types:', err);
    res.status(500).json({ message: err.message });
  }
});

// CREATE requestor type
router.post('/subproject/:subprojectId/requestor-type', async (req, res) => {
  try {
    const { subprojectId } = req.params;
    const { name, rate } = req.body;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subproject = await SubProject.findById(subprojectId);
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    const requestorType = new SubprojectRequestorType({
      subproject_id: subprojectId,
      project_id: subproject.project_id,
      client_id: subproject.client_id,
      geography_id: subproject.geography_id,
      name,
      rate: parseFloat(rate) || 0
    });

    await requestorType.save();
    res.status(201).json(requestorType);
  } catch (err) {
    console.error('Error creating requestor type:', err);
    if (err.code === 11000) {
      return res.status(409).json({ message: 'Requestor type already exists' });
    }
    res.status(500).json({ message: err.message });
  }
});

// UPDATE requestor type
router.put('/subproject/:subprojectId/requestor-type/:requestorTypeId', async (req, res) => {
  try {
    const { subprojectId, requestorTypeId } = req.params;
    const { rate } = req.body;

    const requestorType = await SubprojectRequestorType.findOne({
      _id: requestorTypeId,
      subproject_id: subprojectId
    });

    if (!requestorType) {
      return res.status(404).json({ message: 'Requestor type not found' });
    }

    if (rate !== undefined) {
      requestorType.rate = parseFloat(rate);
    }

    await requestorType.save();
    res.json(requestorType);
  } catch (err) {
    console.error('Error updating requestor type:', err);
    res.status(500).json({ message: err.message });
  }
});

// DELETE requestor type
router.delete('/subproject/:subprojectId/requestor-type/:requestorTypeId', async (req, res) => {
  try {
    const { subprojectId, requestorTypeId } = req.params;

    const result = await SubprojectRequestorType.deleteOne({
      _id: requestorTypeId,
      subproject_id: subprojectId
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Requestor type not found' });
    }

    res.json({ message: 'Requestor type deleted successfully' });
  } catch (err) {
    console.error('Error deleting requestor type:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;