// models/AllocationUploadMeta.js - NEW
const mongoose = require('mongoose');

const allocationUploadMetaSchema = new mongoose.Schema({
  upload_date: {
    type: Date,
    default: Date.now,
    required: true
  },
  start_date: {
    type: Date,
    required: true
  },
  end_date: {
    type: Date,
    required: true
  },
  total_records: {
    type: Number,
    required: true
  },
  unique_combinations: {
    type: Number,
    required: true
  },
  months: [{
    type: Number
  }],
  years: [{
    type: Number
  }],
  uploaded_by: {
    type: String,
    default: 'System'
  }
}, {
  timestamps: true
});

allocationUploadMetaSchema.index({ upload_date: -1 });
allocationUploadMetaSchema.index({ start_date: 1, end_date: 1 });

module.exports = mongoose.model('AllocationUploadMeta', allocationUploadMetaSchema);