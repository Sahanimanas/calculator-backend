// models/Billing.js
const mongoose = require('mongoose');

const BillingSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  project_name: String,
  subproject_name: String,
  
  // ✅ NEW: Store the selected request type
  request_type: { type: String }, 
  
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  resource_name: String,
  productivity_level: String,
  
  hours: Number,
  rate: Number,
  flatrate: { type: Number, default: 0 },
  costing: Number,
  total_amount: Number,
  
  billable_status: { type: String, default: 'Non-Billable' },
  description: String,
  month: Number || null,
  year: Number || null,
}, { timestamps: true });

// ✅ NEW: Compound Index to prevent duplicate billing records
// This ensures unique records for a specific resource on a specific subproject/request-type for a specific month.
BillingSchema.index(
  { 
    project_id: 1, 
    subproject_id: 1, 
    resource_id: 1, 
    month: 1, 
    year: 1, 
    request_type: 1 
  }, 
  { unique: true }
);

module.exports = mongoose.model('Billing', BillingSchema);