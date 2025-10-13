// models/Resource.js
const mongoose = require('mongoose');

const ResourceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: String,
  email: String,
  assigned_projects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Project' }],
  assigned_subprojects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subproject' }],
  avatar_url: String,
}, { timestamps: true });

module.exports = mongoose.model('Resource', ResourceSchema);
