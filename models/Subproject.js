// models/Subproject.js
const mongoose = require('mongoose');

const SubprojectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  status: { type: String, default: 'active' },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Subproject', SubprojectSchema);
