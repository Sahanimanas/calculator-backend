// models/SubprojectRequestType.js - UPDATED to support both Verisma and MRO
const mongoose = require('mongoose');

const SubprojectRequestTypeSchema = new mongoose.Schema({
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  
  // Request Type Name - Extended to support both Verisma and MRO
  name: { 
    type: String, 
    enum: [
      // ============================================
      // VERISMA REQUEST TYPES
      // ============================================
      'New Request', 
      'Key', 
      'Duplicate',
      
      // ============================================
      // MRO REQUEST TYPES
      // ============================================
      'Batch',
      'DDS',
      'E-link',
      'E-Request',
      'Follow up',
      // 'New Request' - already included above
    ], 
    required: true 
  },
  
  rate: { type: Number, default: 0 },
}, { timestamps: true });

// Prevent duplicate request types for the same subproject
SubprojectRequestTypeSchema.index({ subproject_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SubprojectRequestType', SubprojectRequestTypeSchema);