// models/SubprojectRequestType.js - UPDATED
const mongoose = require('mongoose');

const SubprojectRequestTypeSchema = new mongoose.Schema({
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  
  name: { 
    type: String, 
    enum: ['New Request', 'Key', 'Duplicate'], 
    required: true 
  },
  
  rate: { type: Number, default: 0 },
}, { timestamps: true });

// Prevent duplicate request types for the same subproject
SubprojectRequestTypeSchema.index({ subproject_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SubprojectRequestType', SubprojectRequestTypeSchema);