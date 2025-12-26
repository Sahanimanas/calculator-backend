// models/SubprojectRequestType.js
const mongoose = require('mongoose');

const SubprojectRequestTypeSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  
  // ✅ Updated to use Enum
  name: { 
    type: String, 
    enum: ['Duplicate', 'Key', 'New Request'], 
    required: true 
  },
  
  rate: { type: Number, default: 0 },
}, { timestamps: true });

// Prevent duplicate request types (e.g., cannot have two 'Key' entries for the same subproject)
SubprojectRequestTypeSchema.index({ subproject_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('SubprojectRequestType', SubprojectRequestTypeSchema);