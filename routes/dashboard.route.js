const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Resource = require('../models/Resource');
const Billing = require('../models/Billing');

// GET /api/dashboard
router.get('/', async (req, res) => {
  try {
    // --- 1️⃣ Total Projects ---
    const totalProjects = await Project.countDocuments();

    // --- 2️⃣ Total Resources ---
    const totalResources = await Resource.countDocuments();

    // --- 3️⃣ Billable Resources (unique resource_ids where billable_status = 'billed') ---
    const billableResourceIds = await Billing.distinct('resource_id', {
      billable_status: 'Billable',
    });
    const billableResources = billableResourceIds.length;

    // --- 4️⃣ Current Month Billing Total ---
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // JS months are 0-indexed
    const currentYear = now.getFullYear();

    const currentMonthBillingData = await Billing.aggregate([
      {
        $match: {
          month: currentMonth,
          year: currentYear,
        },
      },
      {
        $group: {
          _id: null,
          totalAmount: { $sum: '$total_amount' },
        },
      },
    ]);

    const currentMonthBilling =
      currentMonthBillingData.length > 0
        ? currentMonthBillingData[0].totalAmount
        : 0;

    // --- ✅ Response ---
    res.json({
      totalProjects,
      totalResources,
      billableResources,
      currentMonthBilling,
    });
  } catch (err) {
    console.error('Dashboard Error:', err);
    res.status(500).json({ message: 'Server Error', error: err.message });
  }
});

module.exports = router;
