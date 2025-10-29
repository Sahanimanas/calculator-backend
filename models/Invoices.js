// models/Invoice.js
const mongoose = require('mongoose');
const crypto = require('crypto');

// Embedded billing record schema
const BillingRecordSchema = new mongoose.Schema({
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
  subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject' },
  project_name: String,
  subproject_name: String,
  resource_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resource' },
  resource_name: String,
  productivity_level: String,
  hours: Number,
  rate: Number,
  flatrate: { type: Number, default: 0 },
  costing: Number,
  total_amount: Number,
  billable_status: { type: String, default: 'Non-Billable' },
  description: String,
  month: Number,
  year: Number,
  // Optional: keep reference to original billing record if needed
  original_billing_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Billing' }
}, { _id: true, timestamps: false });

const InvoiceSchema = new mongoose.Schema({
  invoice_number: { type: String, required: true, unique: true },
  
  // Store billing records directly as embedded documents
  billing_records: [BillingRecordSchema],
  
  // Keep reference IDs for backward compatibility (optional)
  billing_record_ids: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Billing'
  }],
  
  total_billable_hours: { type: Number, default: 0 },
  total_non_billable_hours: { type: Number, default: 0 },
  total_billable_amount: { type: Number, default: 0 },
  total_non_billable_amount: { type: Number, default: 0 },
  total_billing_amount: { type: Number, default: 0 },
  total_costing_amount: { type: Number, default: 0 },
}, { timestamps: true });

// Updated helper method - no longer needs populate
InvoiceSchema.methods.calculateTotals = function () {
  let billableHours = 0;
  let nonBillableHours = 0;
  let billableAmount = 0;
  let nonBillableAmount = 0;
  let totalCostingAmount = 0;

  this.billing_records.forEach(bill => {
    if (bill.billable_status === 'Billable') {
      billableHours += bill.hours || 0;
      billableAmount += bill.total_amount || 0;
    } else {
      nonBillableHours += bill.hours || 0;
      nonBillableAmount += bill.costing || 0;
    }

    totalCostingAmount += bill.costing || 0;
  });

  this.total_billable_hours = billableHours;
  this.total_non_billable_hours = nonBillableHours;
  this.total_billable_amount = billableAmount;
  this.total_non_billable_amount = nonBillableAmount;
  this.total_costing_amount = totalCostingAmount;
  this.total_billing_amount = billableAmount;

  return this;
};

// Pre-save hook to auto-calculate totals
InvoiceSchema.pre('save', function(next) {
  if (this.billing_records && this.billing_records.length > 0) {
    this.calculateTotals();
  }
  next();
});

// Pre-validate hook to generate invoice number automatically
InvoiceSchema.pre('validate', async function (next) {
  if (this.invoice_number) return next();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  const startOfMonth = new Date(yyyy, now.getMonth(), 1);
  const endOfMonth = new Date(yyyy, now.getMonth() + 1, 0, 23, 59, 59, 999);

  const count = await mongoose.model('Invoice').countDocuments({
    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
  });

  const sequence = String(count + 1).padStart(3, '0');
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase();

  this.invoice_number = `INV-${yyyy}${mm}${dd}-${sequence}-${randomSuffix}`;

  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);