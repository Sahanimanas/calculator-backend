// routes/project.routes.js - UPDATED to include MRO Requestor Types
// Add this section to fetch requestor types for MRO subprojects

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
const SubprojectProductivity = require('../models/SubprojectProductivity');
const Billing = require('../models/Billing');

// ... (keep all existing routes)

// ================= UPDATED: GET sub-projects with Request Types AND Requestor Types =================
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

    // Check if this is an MRO project
    const client = await Client.findById(project.client_id);
    const isMRO = client?.name?.toLowerCase() === 'mro';

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
          // Model might not exist yet
          console.log('SubprojectRequestorType not found, skipping');
        }
      }

      const subProjectsWithRates = subProjects.map(sp => {
        const typesForThisSp = requestTypes.filter(
          rt => rt.subproject_id.toString() === sp._id.toString()
        );
        const requestorTypesForThisSp = requestorTypes.filter(
          rt => rt.subproject_id.toString() === sp._id.toString()
        );
        return {
          ...sp,
          request_types: typesForThisSp.map(rt => ({
            name: rt.name,
            rate: rt.rate,
            _id: rt._id
          })),
          requestor_types: requestorTypesForThisSp.map(rt => ({
            name: rt.name,
            rate: rt.rate,
            _id: rt._id
          })),
          isMRO
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

    // Fetch requestor types (for MRO)
    let requestorTypes = [];
    if (isMRO) {
      try {
        requestorTypes = await SubprojectRequestorType.find({
          subproject_id: { $in: subProjectIds }
        }).lean();
      } catch (e) {
        console.log('SubprojectRequestorType not found, skipping');
      }
    }

    const subProjectsWithRates = subProjects.map(sp => {
      const typesForThisSp = requestTypes.filter(
        rt => rt.subproject_id.toString() === sp._id.toString()
      );
      const requestorTypesForThisSp = requestorTypes.filter(
        rt => rt.subproject_id.toString() === sp._id.toString()
      );

      return {
        ...sp,
        request_types: typesForThisSp.map(rt => ({
          name: rt.name,
          rate: rt.rate,
          _id: rt._id
        })),
        requestor_types: requestorTypesForThisSp.map(rt => ({
          name: rt.name,
          rate: rt.rate,
          _id: rt._id
        })),
        isMRO
      };
    });

    res.json(subProjectsWithRates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= NEW: CRUD for Requestor Types =================

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
    const { name, rate, project_id, client_id, geography_id } = req.body;

    if (!Types.ObjectId.isValid(subprojectId)) {
      return res.status(400).json({ message: 'Invalid subproject ID' });
    }

    const subproject = await SubProject.findById(subprojectId);
    if (!subproject) {
      return res.status(404).json({ message: 'Subproject not found' });
    }

    const existingType = await SubprojectRequestorType.findOne({
      subproject_id: subprojectId,
      name: name
    });

    if (existingType) {
      return res.status(409).json({ 
        message: `Requestor type "${name}" already exists for this location` 
      });
    }

    const requestorType = new SubprojectRequestorType({
      subproject_id: subprojectId,
      project_id: project_id || subproject.project_id,
      client_id: client_id || subproject.client_id,
      geography_id: geography_id || subproject.geography_id,
      name,
      rate: parseFloat(rate) || 0
    });

    await requestorType.save();
    res.status(201).json(requestorType);
  } catch (err) {
    console.error('Error creating requestor type:', err);
    if (err.code === 11000) {
      return res.status(409).json({ 
        message: 'Requestor type already exists for this location' 
      });
    }
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// UPDATE requestor type
router.put('/subproject/:subprojectId/requestor-type/:requestorTypeId', async (req, res) => {
  try {
    const { subprojectId, requestorTypeId } = req.params;
    const { rate } = req.body;

    if (!Types.ObjectId.isValid(subprojectId) || !Types.ObjectId.isValid(requestorTypeId)) {
      return res.status(400).json({ message: 'Invalid ID' });
    }

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

    if (!Types.ObjectId.isValid(subprojectId) || !Types.ObjectId.isValid(requestorTypeId)) {
      return res.status(400).json({ message: 'Invalid ID' });
    }

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