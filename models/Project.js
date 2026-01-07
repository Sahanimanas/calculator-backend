// models/Project.js - UPDATED
const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: String,
  
  // Hierarchical references
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  
  // Denormalized fields for quick access and display
  geography_name: String,
  client_name: String,
  
  visibility: { type: String, enum: ['visible', 'hidden'], default: 'visible' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

// Ensure unique project name per client
ProjectSchema.index({ client_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Project', ProjectSchema);