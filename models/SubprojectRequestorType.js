// models/SubprojectRequestorType.js - MRO-specific Requestor Types with pricing
const mongoose = require('mongoose');

const SubprojectRequestorTypeSchema = new mongoose.Schema({
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  
  // Requestor Type Name - MRO specific
  name: { 
    type: String, 
    enum: [
      'NRS-NO Records',
      'Other Processing (Canceled/Released By Other)',
      'Processed',
      'Processed through File Drop',
      'Manual'  // For backward compatibility with existing billing
    ], 
    required: true 
  },
  
  rate: { type: Number, default: 0 },
}, { timestamps: true });

// Prevent duplicate requestor types for the same subproject
SubprojectRequestorTypeSchema.index({ subproject_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SubprojectRequestorType', SubprojectRequestorTypeSchema);