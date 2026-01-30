// routes/geography.routes.js
const express = require('express');
const router = express.Router();
const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');
// ==================== GET ALL GEOGRAPHIES (with pagination) ====================
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 30, status, search } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const [geographies, totalItems] = await Promise.all([
      Geography.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Geography.countDocuments(query)
    ]);

    // Get client counts for each geography
    const geographiesWithCounts = await Promise.all(
      geographies.map(async (geo) => {
        const clientCount = await Client.countDocuments({ 
          geography_id: geo._id 
        });
        return { ...geo, clientCount };
      })
    );

    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = page < totalPages;

    res.status(200).json({
      geographies: geographiesWithCounts,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        itemsPerPage: parseInt(limit),
        hasNextPage
      }
    });
  } catch (error) {
    console.error('Error fetching geographies:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET CLIENTS BY GEOGRAPHY ====================
router.get('/:id/client', async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const geographyId = req.params.id;

    // Verify geography exists
    const geography = await Geography.findById(geographyId);
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Build query
    const query = { geography_id: geographyId };
    
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // Get clients
    const clients = await Client.find(query)
      .select('_id name status')
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      clients,
      geography: {
        _id: geography._id,
        name: geography.name
      },
      count: clients.length
    });
  } catch (error) {
    console.error('Error fetching clients for geography:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET GEOGRAPHY BY ID ====================
router.get('/:id', async (req, res) => {
  try {
    const geography = await Geography.findById(req.params.id).lean();
    
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Get client count
    const clientCount = await Client.countDocuments({ 
      geography_id: geography._id 
    });

    res.status(200).json({
      ...geography,
      clientCount
    });
  } catch (error) {
    console.error('Error fetching geography:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CREATE GEOGRAPHY ====================
router.post('/', async (req, res) => {
  try {
    const { name, description, status } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Geography name is required' });
    }

    // Check for duplicate name
    const existingGeography = await Geography.findOne({ 
      name: { $regex: `^${name.trim()}$`, $options: 'i' } 
    });

    if (existingGeography) {
      return res.status(409).json({ error: 'Geography with this name already exists' });
    }

    const geography = new Geography({
      name: name.trim(),
      description: description?.trim() || '',
      status: status || 'active'
    });

    await geography.save();

    res.status(201).json(geography);
  } catch (error) {
    console.error('Error creating geography:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Geography with this name already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==================== UPDATE GEOGRAPHY ====================
router.put('/:id', async (req, res) => {
  try {
    const { name, description, status } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Geography name is required' });
    }

    // Check for duplicate name (excluding current geography)
    const existingGeography = await Geography.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: `^${name.trim()}$`, $options: 'i' }
    });

    if (existingGeography) {
      return res.status(409).json({ error: 'Geography with this name already exists' });
    }

    const geography = await Geography.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        description: description?.trim() || '',
        status: status || 'active'
      },
      { new: true, runValidators: true }
    );
    
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Update denormalized geography_name in clients
    await Client.updateMany(
      { geography_id: req.params.id },
      { $set: { geography_name: name.trim() } }
    );

    // Update denormalized geography_name in projects
    await Project.updateMany(
      { geography_id: req.params.id },
      { $set: { geography_name: name.trim() } }
    );

    res.status(200).json(geography);
  } catch (error) {
    console.error('Error updating geography:', error);
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Geography with this name already exists' });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==================== DELETE GEOGRAPHY ====================
// routes/geography.routes.js - DELETE endpoint with cascade deletion support

router.delete('/:id', async (req, res) => {
  try {
    const { cascade } = req.query; // Check if cascade delete is requested
    const geographyId = req.params.id;

    // Find the geography first
    const geography = await Geography.findById(geographyId);
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Get all clients under this geography
    const clients = await Client.find({ geography_id: geographyId });
    const clientIds = clients.map(c => c._id);
    const clientCount = clients.length;

    // If cascade is not requested and there are clients, prevent deletion
    if (!cascade && clientCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete geography with ${clientCount} existing client(s). Delete clients first or use cascade delete.`,
        clientCount
      });
    }

    // If cascade delete is requested, delete everything
    if (cascade && cascade === 'true') {
      let deletedProjects = 0;
      let deletedLocations = 0;
      let deletedClients = 0;

      // Get all projects under all clients
      const projects = await Project.find({ client_id: { $in: clientIds } });
      const projectIds = projects.map(p => p._id);

      // Delete all subprojects/locations under all projects
      if (projectIds.length > 0) {
        const locationResult = await Subproject.deleteMany({ project_id: { $in: projectIds } });
        deletedLocations = locationResult.deletedCount || 0;
      }

      // Delete all projects under all clients
      if (clientIds.length > 0) {
        const projectResult = await Project.deleteMany({ client_id: { $in: clientIds } });
        deletedProjects = projectResult.deletedCount || 0;
      }

      // Delete all clients under this geography
      if (clientIds.length > 0) {
        const clientResult = await Client.deleteMany({ geography_id: geographyId });
        deletedClients = clientResult.deletedCount || 0;
      }

      // Finally, delete the geography
      await Geography.findByIdAndDelete(geographyId);

      console.log(`Cascade deleted geography ${geography.name}: ${deletedClients} clients, ${deletedProjects} projects, ${deletedLocations} locations`);

      return res.status(200).json({ 
        message: 'Geography and all nested data deleted successfully',
        deletedGeography: geography,
        deletedCounts: {
          geography: 1,
          clients: deletedClients,
          projects: deletedProjects,
          locations: deletedLocations,
          total: 1 + deletedClients + deletedProjects + deletedLocations
        }
      });
    }

    // Normal delete (no clients exist)
    await Geography.findByIdAndDelete(geographyId);

    res.status(200).json({ 
      message: 'Geography deleted successfully',
      deletedGeography: geography,
      deletedCounts: {
        geography: 1,
        clients: 0,
        projects: 0,
        locations: 0,
        total: 1
      }
    });
  } catch (error) {
    console.error('Error deleting geography:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET GEOGRAPHY STATS ====================
router.get('/:id/stats', async (req, res) => {
  try {
    const geography = await Geography.findById(req.params.id);
    
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    const [clientCount, projectCount] = await Promise.all([
      Client.countDocuments({ geography_id: req.params.id }),
      Project.countDocuments({ geography_id: req.params.id })
    ]);

    res.status(200).json({
      geography,
      stats: {
        clientCount,
        projectCount
      }
    });
  } catch (error) {
    console.error('Error fetching geography stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BULK DELETE GEOGRAPHIES ====================
router.post('/bulk-delete', async (req, res) => {
  try {
    const { geographyIds } = req.body;

    if (!Array.isArray(geographyIds) || geographyIds.length === 0) {
      return res.status(400).json({ error: 'geographyIds array is required' });
    }

    // Check if any geography has clients
    const clientCount = await Client.countDocuments({ 
      geography_id: { $in: geographyIds } 
    });

    if (clientCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete geographies with existing clients. Delete clients first.` 
      });
    }

    const result = await Geography.deleteMany({ 
      _id: { $in: geographyIds } 
    });

    res.status(200).json({ 
      message: `${result.deletedCount} geographies deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error bulk deleting geographies:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;