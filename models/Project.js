// models/Project.js
const mongoose = require('mongoose');
const Subproject = require('./Subproject.js');
const SubprojectProductivity = require('./SubprojectProductivity');
const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  visibility: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  flatrate: {type: Number, default: 0},
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

// Cascade delete Subprojects and their Productivities
ProjectSchema.pre('deleteOne', { document: true, query: false }, async function(next) {
  try {
    const projectId = this._id;

    // 1️⃣ Delete all productivity tiers for subprojects of this project
    const subprojects = await Subproject.find({ project_id: projectId });
    const subprojectIds = subprojects.map(sp => sp._id);

    await SubprojectProductivity.deleteMany({ subproject_id: { $in: subprojectIds } });

    // 2️⃣ Delete all subprojects
    await Subproject.deleteMany({ project_id: projectId });

    next();
  } catch (err) {
    next(err);
  }
});


module.exports = mongoose.model('Project', ProjectSchema);
