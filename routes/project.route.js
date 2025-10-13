const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const SubProject = require('../models/Subproject.js');
const AuditLog = require('../models/AuditLog');
const { mongo, default: mongoose } = require('mongoose');
// const {   getManagerUser } = require('../middleware/auth');

// ================= GET all projects =================
router.get('/',   async (req, res) => {
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
// GET /project-subprojects
router.get('/project-subproject', async (req, res) => {
  try {
    // Fetch all projects
    const projects = await Project.find().lean();

    // Fetch all subprojects (some may not have valid project references)
    const subprojects = await SubProject.find().populate('project_id', 'name').lean();

    // Group subprojects under their parent project
    const result = projects.map(project => ({
      _id: project._id,
      name: project.name,
      description: project.description,
      visibility: project.visibility,
      created_on: project.created_on,
      updated_at: project.updated_at,
      subprojects: subprojects
        .filter(sp => sp.project_id && sp.project_id._id && sp.project_id._id.toString() === project._id.toString())
        .map(sp => ({
          _id: sp._id,
          name: sp.name,
          description: sp.description,
          status: sp.status,
          created_on: sp.created_on,
          updated_at: sp.updated_at
        }))
    }));

    res.json(result);
  } catch (err) {
    console.error('Error fetching project-subproject data:', err);
    res.status(500).json({ message: err.message });
  }
});


// ================= CREATE project =================
router.post('/',   async (req, res) => {
  try {
    
    let { name, description, visibility } = req.body;
    if(!name){
        return res.status(400).json({ message: 'Project name is required' });
    }
    if(visibility==true){
        visibility='visible';
    }
    if(visibility==false){
        visibility='hidden';
    }
    const project = new Project({
      name,
      description,
      visibility,
    //    
    });
    await project.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CREATE',
    //   entity_type: 'Project',
    //   entity_id: project._id,
    //   description: `User ${req.user.email} created project ${name}`,
    //   details: { name, visibility }
    // });
    
    res.status(201).json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE project =================
router.put('/:id',   async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    Object.assign(project, req.body);
    await project.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'UPDATE',
    //   entity_type: 'Project',
    //   entity_id: project._id,
    //   description: `User ${req.user.email} updated project ${project.name}`,
    //   details: req.body
    // });

    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= DELETE sub-project =================
router.delete('/subproject/:id',   async (req, res) => {
  try {
    const subProject = await SubProject.findById(req.params.id);
    if (!subProject) return res.status(404).json({ message: 'Sub-project not found' });

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'DELETE',
    //   entity_type: 'SubProject',
    //   entity_id: subProject._id,
    //   description: `User ${req.user.email} deleted sub-project ${subProject.name}`,
    //   details: { deleted_sub_project_name: subProject.name }
    // });

    await subProject.deleteOne();
    res.status(200).json({ message: 'Sub-project deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// ================= DELETE project =================
router.delete('/:id',   async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'DELETE',
    //   entity_type: 'Project',
    //   entity_id: project._id,
    //   description: `User ${req.user.email} deleted project ${project.name}`,
    //   details: { deleted_project_name: project.name }
    // });

    await project.deleteOne(); // cascade should handle sub-projects if configured
    res.status(200).json({ message: 'Project deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET all sub-projects =================
router.get('/sub-project',   async (req, res) => {
  try {
    const { project_id, status } = req.query;
    // console.log(req.query)
    const filters = {};
    if (project_id) filters. project_id = project_id;
    if (status) filters.status = status;

    const subProjects = await SubProject.find(filters).sort({ created_on: -1 });
    res.json(subProjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= CREATE sub-project =================
router.post('/sub-project',   async (req, res) => {
  try {
    const {  project_id, name, description} = req.body;
    if(! project_id || !name ){
        return res.status(400).json({ message: 'Project ID, Sub-project name, description, and status are required' });
    }

    const parentProject = await Project.findById( project_id);
    if (!parentProject) return res.status(404).json({ message: 'Parent project not found' });

    const subProject = new SubProject({
       project_id,
      name,
      description,
    
       
    });
    await subProject.save();

    // await AuditLog.create({
    //   user_id: req.user._id,
    //   action: 'CREATE',
    //   entity_type: 'SubProject',
    //   entity_id: subProject._id,
    //   description: `User ${req.user.email} created sub-project ${name} under project ${parentProject.name}`,
    //   details: { name, parent_project: parentProject.name, status }
    // });

    res.status(201).json(subProject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});


// ================= UPDATE sub-project =================
router.put('/subproject/:id',   async (req, res) => {
 try {
  const subProject = await SubProject.findById(req.params.id);
  if (!subProject) return res.status(404).json({ message: 'Sub-project not found' });

  const { name, parentProjectId, status, description } = req.body;
  if(!name || !parentProjectId || !status){
    return res.status(400).json({ message: 'Sub-project name, parent project ID, and status are required' });
  }
  const parentProject = new mongoose.Types.ObjectId(parentProjectId);
  // Update fields directly
  subProject.name = name ?? subProject.name;
  subProject.project_id = parentProject  ?? subProject.project_id;
  subProject.status = status ?? subProject.status;
  subProject.description = description ?? subProject.description;

  // Save updated document
  await subProject.save();

  // Optional: log audit
  // await AuditLog.create({
  //   user_id: req.user._id,
  //   action: 'UPDATE',
  //   entity_type: 'SubProject',
  //   entity_id: subProject._id,
  //   description: `User ${req.user.email} updated sub-project ${subProject.name}`,
  //   details: req.body
  // });

  res.json(subProject);
} catch (err) {
  console.error(err);
  res.status(500).json({ message: err.message });
}
});

// ================= GET sub-projects for a project =================
router.get('/:project_id/subproject',   async (req, res) => {
  try {
    const project = await Project.findById(req.params.project_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const subProjects = await SubProject.find({  project_id: req.params.project_id });
    res.json(subProjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});
// ================= GET single project =================
router.get('/:id',   async (req, res) => {
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
