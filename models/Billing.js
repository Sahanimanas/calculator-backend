// models/Billing.js
const mongoose = require('mongoose');

const BillingSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject', required: true },
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  productivity_level: String,
  hours: Number,
  rate: Number,
  total_amount: Number,
  billable_status: { type: String, default: 'Non-Billable' },
  description: String,
  month: Number,
  year: Number,
}, { timestamps: true });

module.exports = mongoose.model('Billing', BillingSchema);
