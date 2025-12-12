const billingService = require('../services/billingService');
const invoiceService = require('../services/invoiceService');

module.exports = {
  billingSyncBulk: async (_, { records }) => {
    return billingService.syncBillingRecords(records);
  },

  updateBilling: async (_, { billingId, hours, productivity }) => {
    const fields = { hours };
    if (productivity) fields.productivity_level = productivity;
    const updated = await billingService.updateBilling(billingId, fields);
    return { billingId: updated._id.toString(), uniqueId: `${updated.project_id}-${updated.subproject_id}-${updated.resource_id}` };
  },

  createInvoice: async (_, { month, year }) => {
    const result = await invoiceService.createInvoiceForMonth({ month, year });
    return { invoiceNumber: result.invoiceNumber, invoiceId: result.invoiceId };
  }
};
    