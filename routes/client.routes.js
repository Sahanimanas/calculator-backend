// routes/client.routes.js
const express = require('express');
const router = express.Router();
const Client = require('../models/Client');
const Geography = require('../models/Geography');
const Project = require('../models/Project');

// ==================== GET CLIENTS BY GEOGRAPHY (with pagination) ====================
router.get('/geography/:geographyId', async (req, res) => {
  try {
    const { page = 1, limit = 30, status, search } = req.query;
    const skip = (page - 1) * limit;

    // Build query
    const query = { geography_id: req.params.geographyId };
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const [clients, totalItems] = await Promise.all([
      Client.find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Client.countDocuments(query)
    ]);

    // Get project counts for each client
    const clientsWithCounts = await Promise.all(
      clients.map(async (client) => {
        const projectCount = await Project.countDocuments({ 
          client_id: client._id 
        });
        return { ...client, projectCount };
      })
    );

    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = page < totalPages;
    const hasMore = hasNextPage;

    res.status(200).json({
      clients: clientsWithCounts,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        itemsPerPage: parseInt(limit),
        hasNextPage,
        hasMore
      }
    });
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== SEARCH CLIENTS ====================
router.get('/search', async (req, res) => {
  try {
    const { query, geography_id, limit = 10 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchQuery = {
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } }
      ]
    };

    if (geography_id) {
      searchQuery.geography_id = geography_id;
    }

    const clients = await Client.find(searchQuery)
      .populate('geography_id', 'name')
      .limit(parseInt(limit))
      .sort({ name: 1 })
      .lean();

    res.status(200).json(clients);
  } catch (error) {
    console.error('Error searching clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET ALL CLIENTS (for dropdowns) ====================
router.get('/', async (req, res) => {
  try {
    const { status, geography_id, search, limit = 50 } = req.query;

    // Build query
    const query = {};
    if (status) query.status = status;
    if (geography_id) query.geography_id = geography_id; // Optional filter
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const clients = await Client.find(query)
      .populate('geography_id', 'name')
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .lean();

    res.status(200).json(clients);
  } catch (error) {
    console.error('Error fetching clients:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET PROJECTS BY CLIENT (NEW - for dashboard filter) ====================
router.get('/:id/project', async (req, res) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    const clientId = req.params.id;

    // Verify client exists
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Build query
    const query = { client_id: clientId };
    
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    // Get projects
    const projects = await Project.find(query)
      .select('_id name status')
      .sort({ name: 1 })
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      projects,
      client: {
        _id: client._id,
        name: client.name
      },
      count: projects.length
    });
  } catch (error) {
    console.error('Error fetching projects for client:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET CLIENT STATS ====================
router.get('/:id/stats', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate('geography_id', 'name');
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const projectCount = await Project.countDocuments({ 
      client_id: req.params.id 
    });

    // Get active vs inactive projects
    const [activeProjects, inactiveProjects] = await Promise.all([
      Project.countDocuments({ client_id: req.params.id, status: 'active' }),
      Project.countDocuments({ client_id: req.params.id, status: 'inactive' })
    ]);

    res.status(200).json({
      client,
      stats: {
        totalProjects: projectCount,
        activeProjects,
        inactiveProjects
      }
    });
  } catch (error) {
    console.error('Error fetching client stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== GET CLIENT BY ID ====================
router.get('/:id', async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate('geography_id', 'name')
      .lean();
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Get project count
    const projectCount = await Project.countDocuments({ 
      client_id: client._id 
    });

    res.status(200).json({
      ...client,
      projectCount
    });
  } catch (error) {
    console.error('Error fetching client:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== CREATE CLIENT ====================
router.post('/', async (req, res) => {
  try {
    const { name, description, status, geography_id } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    if (!geography_id) {
      return res.status(400).json({ error: 'Geography is required' });
    }

    // Verify geography exists
    const geography = await Geography.findById(geography_id);
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Check for duplicate name within the same geography
    const existingClient = await Client.findOne({
      geography_id,
      name: { $regex: `^${name.trim()}$`, $options: 'i' }
    });

    if (existingClient) {
      return res.status(409).json({ 
        error: 'Client with this name already exists in this geography' 
      });
    }

    const client = new Client({
      name: name.trim(),
      description: description?.trim() || '',
      status: status || 'active',
      geography_id,
      geography_name: geography.name
    });

    await client.save();

    res.status(201).json(client);
  } catch (error) {
    console.error('Error creating client:', error);
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Client with this name already exists in this geography' 
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==================== UPDATE CLIENT ====================
router.put('/:id', async (req, res) => {
  try {
    const { name, description, status, geography_id } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    if (!geography_id) {
      return res.status(400).json({ error: 'Geography is required' });
    }

    // Verify geography exists
    const geography = await Geography.findById(geography_id);
    if (!geography) {
      return res.status(404).json({ error: 'Geography not found' });
    }

    // Check for duplicate name (excluding current client)
    const existingClient = await Client.findOne({
      _id: { $ne: req.params.id },
      geography_id,
      name: { $regex: `^${name.trim()}$`, $options: 'i' }
    });

    if (existingClient) {
      return res.status(409).json({ 
        error: 'Client with this name already exists in this geography' 
      });
    }

    const client = await Client.findByIdAndUpdate(
      req.params.id,
      {
        name: name.trim(),
        description: description?.trim() || '',
        status: status || 'active',
        geography_id,
        geography_name: geography.name
      },
      { new: true, runValidators: true }
    );
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Update denormalized client_name in projects
    await Project.updateMany(
      { client_id: req.params.id },
      { 
        $set: { 
          client_name: name.trim(),
          geography_id,
          geography_name: geography.name
        } 
      }
    );

    res.status(200).json(client);
  } catch (error) {
    console.error('Error updating client:', error);
    if (error.code === 11000) {
      return res.status(409).json({ 
        error: 'Client with this name already exists in this geography' 
      });
    }
    res.status(400).json({ error: error.message });
  }
});

// ==================== DELETE CLIENT ====================
router.delete('/:id', async (req, res) => {
  try {
    // Check if client has projects
    const projectCount = await Project.countDocuments({ 
      client_id: req.params.id 
    });
    
    if (projectCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete client with ${projectCount} existing project(s). Delete projects first.` 
      });
    }

    const client = await Client.findByIdAndDelete(req.params.id);
    
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.status(200).json({ 
      message: 'Client deleted successfully',
      deletedClient: client
    });
  } catch (error) {
    console.error('Error deleting client:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== BULK DELETE CLIENTS ====================
router.post('/bulk-delete', async (req, res) => {
  try {
    const { clientIds } = req.body;

    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return res.status(400).json({ error: 'clientIds array is required' });
    }

    // Check if any client has projects
    const projectCount = await Project.countDocuments({ 
      client_id: { $in: clientIds } 
    });

    if (projectCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete clients with existing projects. Delete projects first.` 
      });
    }

    const result = await Client.deleteMany({ 
      _id: { $in: clientIds } 
    });

    res.status(200).json({ 
      message: `${result.deletedCount} clients deleted successfully`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error bulk deleting clients:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;