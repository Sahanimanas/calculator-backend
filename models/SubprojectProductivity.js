// models/SubprojectProductivity.js - UPDATED
const mongoose = require('mongoose');

const SubprojectProductivitySchema = new mongoose.Schema({
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  
  level: { type: String, enum: ['low', 'medium', 'high', 'best'], required: true },
  base_rate: Number,
}, { timestamps: true });

// Ensure unique productivity level per subproject
SubprojectProductivitySchema.index({ subproject_id: 1, level: 1 }, { unique: true });

module.exports = mongoose.model('SubprojectProductivity', SubprojectProductivitySchema);