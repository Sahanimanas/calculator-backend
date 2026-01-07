const express = require('express');
const router = express.Router();
const Resource = require('../models/Resource');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const mongoose = require('mongoose');
const Billing = require('../models/Billing');  
const SubprojectProductivity = require('../models/SubprojectProductivity'); 

// ==================== OPTIMIZED GET RESOURCES ====================
router.get('/', async (req, res) => {
  try {
    const { 
      role, 
      billable_status, 
      project_id, 
      subproject_id, 
      search,
      page, 
      limit 
    } = req.query;

    const query = {};

    if (role) query.role = role;
    if (billable_status) {
        query.isBillable = billable_status === 'billable'; 
    }
    if (project_id) query.assigned_projects = project_id;
    if (subproject_id) query.assigned_subprojects = subproject_id;
    
    if (search && search.trim() !== "") {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { role: searchRegex }
      ];
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10; 
    const skip = (pageNum - 1) * limitNum;

    const [resources, total] = await Promise.all([
      Resource.find(query)
        .populate('assigned_projects', 'name')
        .populate('assigned_subprojects', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Resource.countDocuments(query)
    ]);

    const transformedResources = resources.map(r => ({
      ...r,
      project_names: r.assigned_projects?.map(p => p.name) || [],
      subproject_names: r.assigned_subprojects?.map(sp => sp.name) || [],
    }));

    res.json({
      resources: transformedResources,
      totalPages: Math.ceil(total / limitNum),
      totalResources: total,
      currentPage: pageNum
    });

  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: err.message });
  }
});

// ==================== NEW: SEARCH PROJECTS (Paginated) ====================
// Returns max 20 results at a time based on search query
router.get('/search-projects', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, ids } = req.query;
    
    // If specific IDs are requested (for pre-populating selected items)
    if (ids) {
      const idArray = ids.split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
      if (idArray.length === 0) return res.json({ projects: [], total: 0 });
      
      const projects = await Project.find({ _id: { $in: idArray } })
        .select('_id name')
        .lean();
      
      return res.json({ 
        projects: projects.map(p => ({ value: p._id, label: p.name })),
        total: projects.length 
      });
    }

    const query = {};
    if (search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50); // Cap at 50
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(query)
        .select('_id name')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Project.countDocuments(query)
    ]);

    res.json({
      projects: projects.map(p => ({ value: p._id, label: p.name })),
      total,
      hasMore: skip + projects.length < total
    });

  } catch (err) {
    console.error("Error searching projects:", err);
    res.status(500).json({ message: err.message });
  }
});

// ==================== NEW: SEARCH SUBPROJECTS (Paginated) ====================
// Returns max 20 results, optionally filtered by project_ids
router.get('/search-subprojects', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 20, project_ids, ids } = req.query;
    
    // If specific IDs are requested (for pre-populating selected items)
    if (ids) {
      const idArray = ids.split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
      if (idArray.length === 0) return res.json({ subprojects: [], total: 0 });
      
      const subprojects = await Subproject.find({ _id: { $in: idArray } })
        .select('_id name project_id')
        .lean();
      
      return res.json({ 
        subprojects: subprojects.map(sp => ({ 
          value: sp._id, 
          label: sp.name,
          project_id: sp.project_id 
        })),
        total: subprojects.length 
      });
    }

    const query = {};
    
    // Filter by project IDs if provided
    if (project_ids) {
      const projectIdArray = project_ids.split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
      if (projectIdArray.length > 0) {
        query.project_id = { $in: projectIdArray };
      }
    }
    
    if (search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 50);
    const skip = (pageNum - 1) * limitNum;

    const [subprojects, total] = await Promise.all([
      Subproject.find(query)
        .select('_id name project_id')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Subproject.countDocuments(query)
    ]);

    res.json({
      subprojects: subprojects.map(sp => ({ 
        value: sp._id, 
        label: sp.name,
        project_id: sp.project_id 
      })),
      total,
      hasMore: skip + subprojects.length < total
    });

  } catch (err) {
    console.error("Error searching subprojects:", err);
    res.status(500).json({ message: err.message });
  }
});

// ==================== EXISTING: Get Subprojects by Project IDs ====================
router.get('/subprojects-for-projects', async (req, res) => {
  try {
    const { project_ids } = req.query;
    
    if (!project_ids) {
      return res.json([]);
    }

    const projectIdArray = project_ids.split(',').filter(id => mongoose.Types.ObjectId.isValid(id));
    
    if (projectIdArray.length === 0) {
      return res.json([]);
    }

    const subprojects = await Subproject.find({
      project_id: { $in: projectIdArray }
    })
    .select('_id name project_id')
    .sort({ name: 1 })
    .lean();

    res.json(subprojects);
  } catch (err) {
    console.error("Error fetching filtered subprojects:", err);
    res.status(500).json({ message: err.message });
  }
});

// --- GET single resource ---
router.get('/:id', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id)
      .populate('assigned_projects', 'name')
      .populate('assigned_subprojects', 'name')
      .lean();

    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    res.json(resource);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- CREATE RESOURCE ---
router.post('/', async (req, res) => {
  try {
    let { name, role, email, assigned_projects, assigned_subprojects, avatar_url } = req.body;

    if (!name || !role || !email) {
      return res.status(400).json({ message: 'Name, role, and email are required' });
    }

    if (!avatar_url) {
      avatar_url = 'https://imgs.search.brave.com/TJfABfGoj8ozO-c1s6H0C8LH0vqWWZvcck4eEPo6f5U/rs:fit:500:0:1:0/g:ce/aHR0cHM6Ly9tZWRp/YS5pc3RvY2twaG90/by5jb20vaWQvMTMz/NzE0NDE0Ni92ZWN0/b3IvZGVmYXVsdC1h/dmF0YXItcHJvZmls/ZS1pY29uLXZlY3Rv/ci5qcGc_cz02MTJ4/NjEyJnc9MCZrPTIw/JmM9QkliRnd1djdG/eFRXdmg1UzN2QjZi/a1QwUXY4Vm44TjVG/ZnNlcTg0Q2xHST0';
    }

    const existing = await Resource.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const validProjectIds = Array.isArray(assigned_projects)
      ? assigned_projects.filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];

    const validSubProjectIds = Array.isArray(assigned_subprojects)
      ? assigned_subprojects.filter(id => mongoose.Types.ObjectId.isValid(id))
      : [];

    const resource = new Resource({
      name,
      role,
      email,
      avatar_url,
      assigned_projects: validProjectIds,
      assigned_subprojects: validSubProjectIds,
    });
    await resource.save();

    if (validProjectIds.length && validSubProjectIds.length) {
      const [projects, subprojects, productivityData] = await Promise.all([
        Project.find({ _id: { $in: validProjectIds } }).lean(),
        Subproject.find({ _id: { $in: validSubProjectIds } }).lean(),
        SubprojectProductivity.find({
          project_id: { $in: validProjectIds },
          subproject_id: { $in: validSubProjectIds },
        }).lean(),
      ]);

      const billingRecords = [];

      for (const project of projects) {
        for (const subproject of subprojects) {
          const prod = productivityData.find(
            (p) =>
              p.project_id.toString() === project._id.toString() &&
              p.subproject_id.toString() === subproject._id.toString()
          );

          const productivity_level = prod ? prod.level : 'medium';
          const rate = prod ? prod.base_rate : 0;
          const flatrate = project.flatrate || 0;

          billingRecords.push({
            project_id: project._id,
            subproject_id: subproject._id,
            project_name: project.name,
            subproject_name: subproject.name,
            resource_id: resource._id,
            resource_name: resource.name,
            productivity_level,
            rate,
            flatrate,
            costing: 0,
            hours: 0,
            total_amount: 0,
            billable_status: 'Billable',
            description: `Auto-generated billing for ${resource.name}`,
            month: null,
            year: new Date().getFullYear(),
          });
        }
      }

      if (billingRecords.length) {
        await Billing.insertMany(billingRecords);
      }
    }

    res.status(201).json({
      message: 'Resource and billing created successfully',
      resource,
    });
  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ message: err.message });
  }
});

// --- UPDATE resource ---
router.put('/:id', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    if (req.body.email && req.body.email !== resource.email) {
      const exists = await Resource.findOne({ email: req.body.email });
      if (exists) return res.status(400).json({ message: 'Email already exists' });
    }

    Object.assign(resource, req.body);
    await resource.save();
    res.json(resource);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- DELETE resource ---
router.delete('/:id', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    await resource.deleteOne();
    res.json({ message: 'Resource deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- TOGGLE billable status ---
router.post('/:id/toggle-billable', async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    resource.billable_status = resource.billable_status === 'Billable' ? 'Non-Billable' : 'Billable';
    resource.billable_inherited = false;
    await resource.save();

    res.json({ message: `Billable status changed to ${resource.billable_status}`, resource });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;