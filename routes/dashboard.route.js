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
      {
        $group: {
          _id: '$billing_records.resource_id',
        },
      },
    ]);
    const billableResources = billableResourceIds.length;

    // --- 4️⃣ Current Month Totals (only latest invoice per project) ---
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const latestInvoices = await Invoice.aggregate([
      // Sort all invoices by createdAt DESC
      { $sort: { createdAt: -1 } },

      // Group by project to keep only the latest invoice for each project
      {
        $group: {
          _id: '$project_id',
          latestInvoice: { $first: '$$ROOT' },
        },
      },

      // Unwind billing_records of the latest invoices
      { $unwind: '$latestInvoice.billing_records' },

      // Match only current month + year billing records
      {
        $match: {
          'latestInvoice.billing_records.month': currentMonth,
          'latestInvoice.billing_records.year': currentYear,
        },
      },

      // Group to get total billing & costing from latest invoices only
      {
        $group: {
          _id: null,
          totalBillingAmount: {
            $sum: '$latestInvoice.billing_records.total_amount',
          },
          totalCostingAmount: {
            $sum: '$latestInvoice.billing_records.costing',
          },
        },
      },
    ]);

    const currentMonthBilling =
      latestInvoices.length > 0 ? latestInvoices[0].totalBillingAmount : 0;
    const currentMonthCosting =
      latestInvoices.length > 0 ? latestInvoices[0].totalCostingAmount : 0;

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
