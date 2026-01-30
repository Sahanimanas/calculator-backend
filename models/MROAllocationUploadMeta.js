// models/MROAllocationUploadMeta.js - MRO Upload Metadata
const mongoose = require('mongoose');

const mroAllocationUploadMetaSchema = new mongoose.Schema({
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
  processing_records: {
    type: Number,
    default: 0
  },
  logging_records: {
    type: Number,
    default: 0
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
  },
  filename: {
    type: String
  }
}, {
  timestamps: true
});

mroAllocationUploadMetaSchema.index({ upload_date: -1 });
mroAllocationUploadMetaSchema.index({ start_date: 1, end_date: 1 });

module.exports = mongoose.model('MROAllocationUploadMeta', mroAllocationUploadMetaSchema);