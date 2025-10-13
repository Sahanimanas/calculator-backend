// models/Invoice.js
const mongoose = require('mongoose');

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
  total_amount: { type: Number, default: 0 },
  status: { 
    type: String, 
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'], 
    default: 'draft' 
  },
}, { timestamps: true });

// Helper method to calculate totals from billing records
// Helper method to calculate totals from billing records
InvoiceSchema.methods.calculateTotals = async function () {
  await this.populate('billing_records'); // just await populate, no execPopulate()

  let billableHours = 0;
  let nonBillableHours = 0;
  let billableAmount = 0;
  let nonBillableAmount = 0;

  this.billing_records.forEach(bill => {
    if (bill.billable_status === 'Billable') {
      billableHours += bill.hours || 0;
      billableAmount += bill.total_amount || 0;
    } else {
      nonBillableHours += bill.hours || 0;
      nonBillableAmount += bill.total_amount || 0;
    }
  });

  this.total_billable_hours = billableHours;
  this.total_non_billable_hours = nonBillableHours;
  this.total_billable_amount = billableAmount;
  this.total_non_billable_amount = nonBillableAmount;
  this.total_amount = billableAmount + nonBillableAmount;

  return this;
};

// Pre-save hook to generate invoice number automatically
InvoiceSchema.pre('validate', async function(next) {
  if (this.invoice_number) return next(); // already has a number

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // month: 01-12

  // Count invoices created this month
  const count = await mongoose.model('Invoice').countDocuments({
    createdAt: {
      $gte: new Date(`${year}-${month}-01T00:00:00.000Z`),
      $lte: new Date(`${year}-${month}-31T23:59:59.999Z`)
    }
  });

  const sequence = String(count + 1).padStart(3, '0');
  this.invoice_number = `INV-${year}-${month}-${sequence}`;

  next();
});

module.exports = mongoose.model('Invoice', InvoiceSchema);
