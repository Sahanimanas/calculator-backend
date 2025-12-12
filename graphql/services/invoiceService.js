const Billing = require('../models/Billing');
const Invoice = require('../models/Invoice');
const mongoose = require('mongoose');

async function createInvoiceForMonth({ month, year }) {
  // Find all billing records that have hours > 0 for that month & year
  const billings = await Billing.find({ month, year, hours: { $gt: 0 } }).lean();
  if (!billings || billings.length === 0) {
    throw new Error('No billable records found for given month/year');
  }

  const invoiceDoc = {
    billing_records: billings.map(b => ({
      project_id: b.project_id,
      subproject_id: b.subproject_id,
      project_name: b.project_name,
      subproject_name: b.subproject_name,
      resource_id: b.resource_id,
      resource_name: b.resource_name,
      productivity_level: b.productivity_level,
      hours: b.hours,
      rate: b.rate,
      flatrate: b.flatrate,
      costing: b.costing,
      total_amount: b.total_amount,
      billable_status: b.billable_status,
      description: b.description,
      month: b.month,
      year: b.year,
      original_billing_id: b._id
    })),
    billing_record_ids: billings.map(b => b._id)
  };

  const created = await Invoice.create(invoiceDoc);
  return { invoiceNumber: created.invoice_number, invoiceId: created._id.toString() };
}

module.exports = {
  createInvoiceForMonth
};
