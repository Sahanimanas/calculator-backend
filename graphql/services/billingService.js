const Billing = require('../models/Billing');
const Invoice = require('../models/Invoice');
const cache = require('../cache');

async function syncBillingRecords(records) {
  // Accept array of records (billingId optional). Return list of { billingId, uniqueId }
  const results = [];
  for (const r of records) {
    const payload = {
      project_id: r.projectId,
      subproject_id: r.subprojectId,
      resource_id: r.resourceId,
      hours: r.hours || 0,
      productivity_level: r.productivity || 'Medium',
      rate: r.rate || 0,
      flatrate: r.flatrate || 0,
      costing: (r.hours || 0) * (r.rate || 0),
      total_amount: (r.hours || 0) * (r.flatrate || 0),
      description: r.description || '',
      billable_status: r.billableStatus || 'Non-Billable',
      month: r.month,
      year: r.year
    };

    if (r.billingId) {
      const updated = await Billing.findByIdAndUpdate(r.billingId, payload, { new: true, upsert: true });
      results.push({ billingId: updated._id, uniqueId: `${r.projectId}-${r.subprojectId}-${r.resourceId}` });
    } else {
      const created = await Billing.create(payload);
      results.push({ billingId: created._id, uniqueId: `${r.projectId}-${r.subprojectId}-${r.resourceId}` });
    }
  }

  // Invalidate costing cache for given month/year
  if (records && records.length > 0) {
    const month = records[0].month;
    const year = records[0].year;
    if (month != null && year != null) {
      await cache.del(`costing:${year}:${month}`);
    }
  }
  return results;
}

async function updateBilling(billingId, fields) {
  const updated = await Billing.findByIdAndUpdate(billingId, fields, { new: true });
  // Invalidate the month/year cache if present
  if (updated && typeof updated.month !== 'undefined' && typeof updated.year !== 'undefined') {
    await cache.del(`costing:${updated.year}:${updated.month}`);
  }
  return updated;
}

module.exports = {
  syncBillingRecords,
  updateBilling
};
