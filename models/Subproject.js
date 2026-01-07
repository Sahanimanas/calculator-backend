// models/Subproject.js - UPDATED
const mongoose = require('mongoose');

const SubprojectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: String,
  status: { type: String, default: 'active' },
  
  // Hierarchical references
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  
  // Denormalized fields
  project_name: String,
  client_name: String,
  geography_name: String,
  
  flatrate: { type: Number, default: 0 },
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

// Ensure unique subproject name per project
SubprojectSchema.index({ project_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Subproject', SubprojectSchema);