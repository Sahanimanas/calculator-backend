// models/AllocationSummary.js - UPDATED
const mongoose = require('mongoose');

const allocationSummarySchema = new mongoose.Schema({
  geography_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Geography',
    required: true
  },
  geography_name: {
    type: String,
    required: true
  },
  geography_type: {
    type: String,
    enum: ['onshore', 'offshore'],
    required: true
  },
  client_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  client_name: {
    type: String,
    required: true
  },
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  project_name: {
    type: String,
    required: true
  },
  subproject_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subproject',
    required: true
  },
  subproject_name: {
    type: String,
    required: true
  },
  request_type: {
    type: String,
    enum: ['New Request', 'Key', 'Duplicate'],
    required: true
  },
  allocation_date: {
    type: Date,
    required: true
  },
  day: {
    type: Number,
    required: true,
    min: 1,
    max: 31
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12
  },
  year: {
    type: Number,
    required: true
  },
  count: {
    type: Number,
    default: 0
  },
  resource_names: [{
    type: String
  }]
}, {
  timestamps: true
});

// Compound indexes for efficient queries
allocationSummarySchema.index({ 
  geography_id: 1, 
  project_id: 1, 
  subproject_id: 1, 
  request_type: 1, 
  allocation_date: 1
});

allocationSummarySchema.index({ allocation_date: 1 });
allocationSummarySchema.index({ month: 1, year: 1 });
allocationSummarySchema.index({ geography_type: 1 });

module.exports = mongoose.model('AllocationSummary', allocationSummarySchema);