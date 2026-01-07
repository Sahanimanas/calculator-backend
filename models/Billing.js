// models/Billing.js - UPDATED
const mongoose = require('mongoose');

const BillingSchema = new mongoose.Schema({
  // Hierarchical IDs
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  
  // Denormalized names for quick display
  geography_name: String,
  client_name: String,
  project_name: String,
  subproject_name: String,
  
  // Request type selection
  request_type: { 
    type: String,
    enum: ['New Request', 'Key', 'Duplicate', null],
    default: null
  }, 
  
  // Resource information
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  resource_name: String,
  resource_role: String,
  productivity_level: { type: String, default: 'Medium' },
  
  // Financial fields
  hours: { type: Number, default: 0 },
  rate: { type: Number, default: 0 },
  flatrate: { type: Number, default: 0 },
  costing: { type: Number, default: 0 },
  total_amount: { type: Number, default: 0 },
  
  billable_status: { type: String, enum: ['Billable', 'Non-Billable'], default: 'Billable' },
  description: String,
  month: { type: Number },
  year: { type: Number },
}, { timestamps: true });

// Compound Index - ensures unique billing per resource-subproject-request_type-month-year
BillingSchema.index(
  { 
    resource_id: 1,
    subproject_id: 1, 
    request_type: 1,
    month: 1, 
    year: 1
  }, 
  { 
    unique: true,
    name: 'billing_unique_resource_subproject_requesttype_month_year'
  }
);

module.exports = mongoose.model('Billing', BillingSchema);