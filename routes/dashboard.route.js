const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Resource = require('../models/Resource');
const Invoice = require('../models/Invoices');

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    // --- 1️⃣ Total Projects ---
    const totalProjects = await Project.countDocuments();

    // --- 2️⃣ Total Resources ---
    const totalResources = await Resource.countDocuments();

    // --- 3️⃣ Billable Resources ---
    const billableResourceIds = await Invoice.aggregate([
      { $unwind: '$billing_records' },
      { $match: { 'billing_records.billable_status': 'Billable' } },
      { $group: { _id: '$billing_records.resource_id' } },
    ]);
    const billableResources = billableResourceIds.length;

    // --- 4️⃣ Current Month Totals (latest data per combination) ---
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const latestMonthlyRecords = await Invoice.aggregate([
      // Unwind all billing records
      { $unwind: '$billing_records' },

      // Match billing records that belong to current month & year
      {
        $match: {
          'billing_records.month': currentMonth,
          'billing_records.year': currentYear,
        },
      },

      // Sort invoices so the latest createdAt appears first
      { $sort: { createdAt: -1 } },

      // Group by unique combo (project, subproject, resource)
      // and keep only the latest record for that combo
      {
        $group: {
          _id: {
            project_id: '$billing_records.project_id',
            subproject_id: '$billing_records.subproject_id',
            resource_id: '$billing_records.resource_id',
          },
          latestRecord: { $first: '$billing_records' },
        },
      },

      // Calculate totals
      {
        $group: {
          _id: null,
          totalBillingAmount: { $sum: '$latestRecord.total_amount' },
          totalCostingAmount: { $sum: '$latestRecord.costing' },
        },
      },
    ]);

    const currentMonthBilling =
      latestMonthlyRecords.length > 0
        ? latestMonthlyRecords[0].totalBillingAmount
        : 0;
    const currentMonthCosting =
      latestMonthlyRecords.length > 0
        ? latestMonthlyRecords[0].totalCostingAmount
        : 0;

    // --- ✅ Final Response ---
    res.json({
      totalProjects,
      totalResources,
      billableResources,
      currentMonthBilling,
      currentMonthCosting,
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;
