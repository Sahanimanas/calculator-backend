const Project = require('../models/Project');
const SubProject = require('../models/Subproject');
const AuditLog = require('../models/AuditLog');
 

const subprojectList = async (req, res) => { 
    try {
       const {project_id} = req.query;
       const filters = {};
       if (project_id) filters.project_id = project_id;
       const subprojects = await SubProject.find(filters).populate('project_id', 'name');
       res.json(subprojects.name);
   } catch (err) {
       console.error(err);
       res.status(500).json({ message: err.message });
   }
}


module.exports =  subprojectList ;