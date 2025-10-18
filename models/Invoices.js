// models/Invoice.js
const mongoose = require('mongoose');
const { nanoid } = require('nanoid'); // <-- add this import at the top
const crypto = require('crypto');


const InvoiceSchema = new mongoose.Schema({
  invoice_number: { type: String, required: true, unique: true },
  billing_records: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Billing'
    }
  ],
  total_billable_hours: { type: Number, default: 0 },
  total_non_billable_hours: { type: Number, default: 0 },
  total_billable_amount: { type: Number, default: 0 },
  total_non_billable_amount: { type: Number, default: 0 },
  total_billing_amount: { type: Number, default: 0 }, // renamed from total_amount
  total_costing_amount: { type: Number, default: 0 }, // new field
}, { timestamps: true });

// Helper method to calculate totals from billing records
InvoiceSchema.methods.calculateTotals = async function () {
  await this.populate('billing_records');

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
      nonBillableAmount += bill.total_amount || 0;
    }

    // Include costing calculation
    totalCostingAmount += bill.costing || 0;
  });

  this.total_billable_hours = billableHours;
  this.total_non_billable_hours = nonBillableHours;
  this.total_billable_amount = billableAmount;
  this.total_non_billable_amount = nonBillableAmount;
  this.total_costing_amount = totalCostingAmount;
  this.total_billing_amount = billableAmount + nonBillableAmount;

  return this;
};

// Pre-save hook to generate invoice number automatically
// Pre-save hook to generate invoice number automatically
InvoiceSchema.pre('validate', async function (next) {
  if (this.invoice_number) return next();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  // Count existing invoices this month to get sequential numbering
  const startOfMonth = new Date(yyyy, now.getMonth(), 1);
  const endOfMonth = new Date(yyyy, now.getMonth() + 1, 0, 23, 59, 59, 999);

  const count = await mongoose.model('Invoice').countDocuments({
    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
  });

  const sequence = String(count + 1).padStart(3, '0'); // e.g. 001, 002, etc.
  const randomSuffix = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 random hex chars

  this.invoice_number = `INV-${yyyy}${mm}${dd}-${sequence}-${randomSuffix}`;

  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
