// models/DatavantDailyAllocation.js - Datavant Daily Allocation Entry by Resources
const mongoose = require('mongoose');

const DatavantDailyAllocationSchema = new mongoose.Schema({
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
  client_name: { type: String, default: 'Datavant' },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  project_name: { type: String, required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  subproject_name: { type: String, required: true },
  
  // ============ DATAVANT-SPECIFIC FIELDS ============
  // Define based on Datavant's actual requirements
  request_type: { 
    type: String, 
    enum: ['Data Request', 'Verification', 'Update', 'New Entry'],
    required: true
  },
  
  data_source: { type: String, trim: true, default: '' },
  
  record_count: { type: Number, default: 1, min: 1 },
  
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
DatavantDailyAllocationSchema.index({ resource_id: 1, allocation_date: 1 });
DatavantDailyAllocationSchema.index({ subproject_id: 1, allocation_date: 1 });
DatavantDailyAllocationSchema.index({ geography_id: 1, month: 1, year: 1 });
DatavantDailyAllocationSchema.index({ month: 1, year: 1 });
DatavantDailyAllocationSchema.index({ is_locked: 1 });

// ============ PRE-SAVE HOOK ============
DatavantDailyAllocationSchema.pre('save', function(next) {
  if (this.allocation_date) {
    const date = new Date(this.allocation_date);
    this.day = date.getDate();
    this.month = date.getMonth() + 1;
    this.year = date.getFullYear();
  }
  
  // Calculate billing
  this.billing_amount = this.billing_rate * this.record_count;
  
  next();
});

// ============ STATIC METHODS ============
DatavantDailyAllocationSchema.statics.getNextSrNo = async function(resourceId, date) {
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

DatavantDailyAllocationSchema.statics.isDateLocked = function(date) {
  const now = new Date();
  const pstOffset = -8 * 60;
  const pstNow = new Date(now.getTime() + (pstOffset - now.getTimezoneOffset()) * 60000);
  
  const entryDate = new Date(date);
  const lastDayOfMonth = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
  const lockDate = new Date(entryDate.getFullYear(), entryDate.getMonth(), lastDayOfMonth, 23, 59, 59);
  
  return pstNow > lockDate;
};

module.exports = mongoose.model('DatavantDailyAllocation', DatavantDailyAllocationSchema);