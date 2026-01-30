// models/MROAllocationSummary.js - MRO Allocation Data Model (Updated with ObjectId references)
const mongoose = require('mongoose');

const mroAllocationSummarySchema = new mongoose.Schema({
  // ============================================
  // HIERARCHY REFERENCES (ObjectIds)
  // ============================================
  geography_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Geography',
    required: true
  },
  client_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    required: true
  },
  subproject_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subproject',
    required: true
  },

  // ============================================
  // DENORMALIZED FIELDS (for quick access/display)
  // ============================================
  geography_name: {
    type: String,
    required: true
  },
  client_name: {
    type: String,
    default: 'MRO'
  },
  project_name: {
    type: String,
    required: true  // "Processing" or "Logging"
  },
  subproject_name: {
    type: String,
    required: true  // Location name
  },

  // ============================================
  // PROCESS TYPE (Processing or Logging)
  // ============================================
  process_type: {
    type: String,
    enum: ['Processing', 'Logging'],
    required: true
  },

  // ============================================
  // REQUESTOR TYPE (Only for Processing)
  // NRS-NO Records = $2.25, Manual = $3.00
  // ============================================
  requestor_type: {
    type: String,
    enum: ['NRS-NO Records', 'Manual', null],
    default: null
  },

  // ============================================
  // REQUEST TYPE (from raw data)
  // ============================================
  request_type: {
    type: String,
    enum: ['New Request', 'Follow up'],
    default: 'New Request'
  },

  // ============================================
  // DATE FIELDS
  // ============================================
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

  // ============================================
  // COUNT & TRACKING
  // ============================================
  count: {
    type: Number,
    default: 1
  },
  resource_name: {
    type: String,
    trim: true
  },
  request_id: {
    type: String,
    trim: true
  }

}, {
  timestamps: true
});

// ============================================
// INDEXES FOR EFFICIENT QUERIES
// ============================================

// Primary query index for Processing summary (by location/subproject)
mroAllocationSummarySchema.index({ 
  process_type: 1, 
  subproject_id: 1, 
  requestor_type: 1,
  year: 1,
  month: 1
});

// Date-based queries
mroAllocationSummarySchema.index({ allocation_date: 1 });
mroAllocationSummarySchema.index({ year: 1, month: 1 });

// Hierarchy-based queries
mroAllocationSummarySchema.index({ geography_id: 1, client_id: 1 });
mroAllocationSummarySchema.index({ client_id: 1, project_id: 1 });
mroAllocationSummarySchema.index({ project_id: 1, subproject_id: 1 });

// Process type queries
mroAllocationSummarySchema.index({ process_type: 1 });

// Location search
mroAllocationSummarySchema.index({ subproject_name: 'text' });

module.exports = mongoose.model('MROAllocationSummary', mroAllocationSummarySchema);