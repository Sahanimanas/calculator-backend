// models/SubprojectProductivity.js
const mongoose = require('mongoose');

const SubprojectProductivitySchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  level: {type: String, enum: ['low', 'medium', 'high','best'], required: true },
  base_rate: Number,
}, { timestamps: true });

module.exports = mongoose.model('SubprojectProductivity', SubprojectProductivitySchema);
