const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const SubProject = require('../models/Subproject.js');
const AuditLog = require('../models/AuditLog');
const { mongo, default: mongoose } = require('mongoose');

// ================= GET all projects =================
router.get('/', async (req, res) => {
  try {
    const { visibility, search } = req.query;
    const filters = {};
    if (visibility) filters.visibility = visibility;
    if (search) filters.name = { $regex: search, $options: 'i' };

    const projects = await Project.find(filters).sort({ created_on: -1 });
    res.json(projects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET /projects-with-totals - MUST BE BEFORE /:id =================
router.get('/projects-with-totals', async (req, res) => {
  try {
    // Extract pagination params from query
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total count of projects
    const totalProjects = await Project.countDocuments();

    // Handle empty projects case
    if (totalProjects === 0) {
      return res.json([]);
    }

    // If no pagination params, fetch all projects
    if (!req.query.page && !req.query.limit) {
      limit = totalProjects;
    }

    // Fetch paginated projects
    const projects = await Project.find()
      .skip(skip)
      .limit(limit)
      .lean();

    // Get project IDs for the current page
    const projectIds = projects.map(p => p._id);

    // Aggregate to get total flatrate sum for each project
    const subprojectTotals = await SubProject.aggregate([
      {
        $match: { project_id: { $in: projectIds } }
      },
      {
        $group: {
          _id: '$project_id',
          totalFlatrate: { $sum: '$flatrate' },
          subprojectCount: { $sum: 1 }
        }
      }
    ]);

    // Create a map for quick lookup
    const totalsMap = {};
    subprojectTotals.forEach(item => {
      totalsMap[item._id.toString()] = {
        totalFlatrate: item.totalFlatrate,
        subprojectCount: item.subprojectCount
      };
    });

    // Combine projects with their totals
    const result = projects.map(project => ({
      _id: project._id,
      name: project.name,
      flatrate: project.flatrate || 0,
      description: project.description,
      visibility: project.visibility,
      status: project.status,
      created_on: project.created_on,
      updated_at: project.updated_at,
      totalFlatrate: totalsMap[project._id.toString()]?.totalFlatrate || 0,
      subprojectCount: totalsMap[project._id.toString()]?.subprojectCount || 0
    }));

    // Set pagination headers
    // res.set({
    //   'X-Total-Count': totalProjects,
    //   'X-Current-Page': page,
    //   'X-Total-Pages': Math.ceil(totalProjects / limit),
    //   'X-Items-Per-Page': limit,
    //   'X-Has-Next-Page': page < Math.ceil(totalProjects / limit),
    //   'X-Has-Prev-Page': page > 1
    // });

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

// ================= GET /project-subproject =================
router.get('/project-subproject', async (req, res) => {
  try {
    // Extract pagination params from query
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Get total count of projects
    const totalProjects = await Project.countDocuments();

    // Fetch paginated projects
    if (totalProjects === 0) {
      return res.json({
        data: [],
        pagination: {
          currentPage: page,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: limit,
          hasNextPage: false,
          hasPrevPage: false
        }
      });
    } 

    if(!req.query.page && !req.query.limit ){
      limit = totalProjects;
    }
    const projects = await Project.find()
      .skip(skip)
      .limit(limit)
      .lean();

    // Get project IDs for the current page
    const projectIds = projects.map(p => p._id);

    // Fetch only subprojects that belong to current page projects
    const subprojects = await SubProject.find({ 
      project_id: { $in: projectIds } 
    }).populate('project_id', 'name').lean();

    // Group subprojects under their parent project
    const result = projects.map(project => ({
      _id: project._id,
      name: project.name,
      flatrate: project.flatrate || 0,
      description: project.description,
      visibility: project.visibility,
      status: project.status,
      created_on: project.created_on,
      updated_at: project.updated_at,
      subprojects: subprojects
        .filter(sp => sp.project_id && sp.project_id._id && sp.project_id._id.toString() === project._id.toString())
        .map(sp => ({
          _id: sp._id,
          name: sp.name,
          flatrate: sp.flatrate || 0,
          description: sp.description,
          status: sp.status,
          created_on: sp.created_on,
          updated_at: sp.updated_at
        }))
    }));

    // Send paginated response
    res.json({
      data: result,
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
    console.error('Error fetching project-subproject data:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET all sub-projects =================
router.get('/sub-project', async (req, res) => {
  try {
    const { project_id, status } = req.query;
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (status) filters.status = status;

    const subProjects = await SubProject.find(filters).sort({ created_on: -1 });
    res.json(subProjects);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE project =================
router.post('/', async (req, res) => {
  console.log("This is the body from the frontend: ", req.body);
  try {
    let { name, description, visibility, projectPrice } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Project name is required' });
    }

    // Normalize project name (trim + lowercase for case-insensitive comparison)
    const normalizedName = name.trim().toLowerCase();

    // Check if project already exists (case-insensitive)
    const existingProject = await Project.findOne({
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') }
    });

    if (existingProject) {
      return res.status(409).json({ message: 'Project with this name already exists' });
    }

    // Normalize visibility to 'visible' or 'hidden'
    if (visibility === true || visibility === 'true') {
      visibility = 'visible';
    } else if (visibility === false || visibility === 'false') {
      visibility = 'hidden';
    } else {
      visibility = 'visible'; // default fallback
    }

    // Create and save new project
    const project = new Project({
      name: name.trim(),
      description,
      visibility,
      flatrate: projectPrice || 0,
    });

    await project.save();

    res.status(201).json(project);
  } catch (err) {
    console.error('Error creating project:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// ================= CREATE sub-project =================
router.post('/sub-project', async (req, res) => {
  try {
    const { project_id, name, description, subProjectPrice } = req.body;

    if (!project_id || !name) {
      return res.status(400).json({ message: 'Project ID and Sub-project name are required' });
    }

    // Verify parent project exists
    const parentProject = await Project.findById(project_id);
    if (!parentProject) {
      return res.status(404).json({ message: 'Parent project not found' });
    }

    // Normalize and validate name (trim + lowercase for duplicate check)
    const normalizedName = name.trim().toLowerCase();

    // Check for duplicate subproject under the same parent project (case-insensitive)
    const existingSubProject = await SubProject.findOne({
      project_id,
      name: { $regex: new RegExp(`^${normalizedName}$`, 'i') },
    });

    if (existingSubProject) {
      return res
        .status(409)
        .json({ message: `Sub-project with this name already exists under "${parentProject.name}"` });
    }

    // Create subproject
    const subProject = new SubProject({
      project_id,
      name: name.trim(),
      description,
      flatrate: subProjectPrice || 0,
      status: 'active',
    });

    await subProject.save();

    res.status(201).json(subProject);
  } catch (err) {
    console.error('Error creating sub-project:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// ================= UPDATE project =================
router.put('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    let { name, description, visibility, projectPrice } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Project name is required' });
    }
    if (visibility == true) {
      visibility = 'visible';
    }
    if (visibility == false) {
      visibility = 'hidden';
    }
    // Update fields directly
    project.name = name ?? project.name;
    project.description = description ?? project.description;
    project.visibility = visibility ?? project.visibility;
    project.flatrate = projectPrice || project.flatrate;

    // Save updated document
    await project.save();

    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE sub-project =================
router.put('/subproject/:id', async (req, res) => {
  try {
    const subProject = await SubProject.findById(req.params.id);
    if (!subProject) return res.status(404).json({ message: 'Sub-project not found' });

    const { name, parentProjectId, status, description, subProjectPrice } = req.body;
    if (!name || !parentProjectId || !status) {
      return res.status(400).json({ message: 'Sub-project name, parent project ID, and status are required' });
    }
    const parentProject = new mongoose.Types.ObjectId(parentProjectId);
    // Update fields directly
    subProject.name = name ?? subProject.name;
    subProject.project_id = parentProject ?? subProject.project_id;
    subProject.status = status ?? subProject.status;
    subProject.description = description ?? subProject.description;

    if (subProjectPrice !== undefined)
      subProject.flatrate = Number(subProjectPrice);
      
    // Save updated document
    await subProject.save();

    res.json(subProject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE sub-project =================
router.delete('/subproject/:id', async (req, res) => {
  try {
    const subProject = await SubProject.findById(req.params.id);
    if (!subProject) return res.status(404).json({ message: 'Sub-project not found' });

    await subProject.deleteOne();
    res.status(200).json({ message: 'Sub-project deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE project =================
router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    await project.deleteOne();
    res.status(200).json({ message: 'Project deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET sub-projects for a project - MUST BE BEFORE /:id =================
router.get('/:project_id/subproject', async (req, res) => {
  try {
    const project = await Project.findById(req.params.project_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const subProjects = await SubProject.find({ project_id: req.params.project_id });
    res.json(subProjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET single project - MUST BE LAST =================
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;