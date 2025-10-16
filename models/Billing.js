// models/Billing.js
const mongoose = require('mongoose');

const BillingSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  project_name: String, // denormalized for easy access
  subproject_name: String, // denormalized for easy access
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  resource_name: String, // denormalized for easy access
  productivity_level: String,
  hours: Number,
  rate: Number,
  flatrate: { type: Number, default: 0 },
  costing:Number,
  total_amount: Number,
  billable_status: { type: String, default: 'Non-Billable' },
  description: String,
  month: Number || null,
  year: Number || null,
}, { timestamps: true });

module.exports = mongoose.model('Billing', BillingSchema);
