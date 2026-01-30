// models/MRODailyAllocation.js - MRO Daily Allocation Entry by Resources
const mongoose = require('mongoose');

const MRODailyAllocationSchema = new mongoose.Schema({
  // ============ SERIAL NUMBER ============
  sr_no: { type: Number },
  
  // ============ DATE FIELDS ============
  allocation_date: { type: Date, required: true },
  day: { type: Number, min: 1, max: 31 },
  month: { type: Number, min: 1, max: 12 },
  year: { type: Number },
  
  // ============ RESOURCE INFO ============
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  resource_name: { type: String, required: true },
  resource_email: { type: String },
  
  // ============ HIERARCHY (from assignment) ============
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  geography_name: { type: String, required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  client_name: { type: String, default: 'MRO' },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  project_name: { type: String, required: true }, // Processing, Logging, MRO Payer Project
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  subproject_name: { type: String, required: true }, // Location name
  
  // ============ MRO-SPECIFIC FIELDS ============
  facility_name: { type: String, trim: true, default: '' },
  
  request_id: { type: String, trim: true, default: '' },
  
  request_type: { 
    type: String, 
    enum: ['Batch', 'DDS', 'E-link', 'E-Request', 'Follow up', 'New Request'],
    required: true
  },
  
  // Only for Processing - determines billing rate
  requestor_type: { 
    type: String, 
    enum: [
      '',
      'NRS-NO Records',           // $2.25
      'Manual',                   // $3.00 or $4.75
      'Other Processing (Canceled/Released By Other)',
      'Processed',
      'Processed through File Drop'
    ],
    default: ''
  },
  
  // Derived from project_name (Processing, Logging, MRO Payer Project)
  process_type: { 
    type: String, 
    enum: ['Processing', 'Logging', 'MRO Payer Project'],
    required: true
  },
  
  remark: { type: String, trim: true, default: '' },
  
  // ============ BILLING ============
  billing_rate: { type: Number, default: 0 },
  billing_amount: { type: Number, default: 0 },
  is_billable: { type: Boolean, default: true },
  
  // ============ STATUS & LOCKING ============
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'rejected'],
    default: 'submitted'
  },
  is_locked: { type: Boolean, default: false },
  locked_at: { type: Date },
  locked_reason: { type: String }
  
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

// ============ INDEXES ============
MRODailyAllocationSchema.index({ resource_id: 1, allocation_date: 1 });
MRODailyAllocationSchema.index({ subproject_id: 1, allocation_date: 1 });
MRODailyAllocationSchema.index({ geography_id: 1, month: 1, year: 1 });
MRODailyAllocationSchema.index({ process_type: 1, month: 1, year: 1 });
MRODailyAllocationSchema.index({ requestor_type: 1, month: 1, year: 1 });
MRODailyAllocationSchema.index({ month: 1, year: 1 });
MRODailyAllocationSchema.index({ is_locked: 1 });

// ============ PRE-SAVE HOOK ============
MRODailyAllocationSchema.pre('save', function(next) {
  if (this.allocation_date) {
    const date = new Date(this.allocation_date);
    this.day = date.getDate();
    this.month = date.getMonth() + 1;
    this.year = date.getFullYear();
  }
  
  // Auto-calculate billing based on process type and requestor type
  if (this.process_type === 'Processing') {
    if (this.requestor_type === 'NRS-NO Records') {
      this.billing_rate = 2.25;
    } else if (this.requestor_type === 'Manual') {
      this.billing_rate = 3.00; // Default, can be 4.75 for some locations
    } else {
      this.billing_rate = 0;
    }
  } else if (this.process_type === 'Logging') {
    this.billing_rate = 1.08;
  } else {
    this.billing_rate = 0;
  }
  
  this.billing_amount = this.billing_rate;
  next();
});

// ============ STATIC METHODS ============
MRODailyAllocationSchema.statics.getNextSrNo = async function(resourceId, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const lastEntry = await this.findOne({
    resource_id: resourceId,
    allocation_date: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ sr_no: -1 });
  
  return lastEntry ? lastEntry.sr_no + 1 : 1;
};

MRODailyAllocationSchema.statics.isDateLocked = function(date) {
  const now = new Date();
  const pstOffset = -8 * 60;
  const pstNow = new Date(now.getTime() + (pstOffset - now.getTimezoneOffset()) * 60000);
  
  const entryDate = new Date(date);
  const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
  const lockDate = new Date(entryDate.getFullYear(), entryDate.getMonth(), lastDayOfMonth, 23, 59, 59);
  
  return pstNow > lockDate;
};

module.exports = mongoose.model('MRODailyAllocation', MRODailyAllocationSchema);