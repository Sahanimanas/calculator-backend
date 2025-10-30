const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoices.js')
const Billing = require('../models/Billing');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const Resource = require('../models/Resource');


router.post('/calculate', async (req, res) => {
  try {
    const {
      project_id,
      subproject_id,
      resource_id,
      month, // e.g. "October 2025"
      billable_status,
      productivity_level,
    } = req.body;

    if (!project_id) {
      return res.status(400).json({ message: 'Project ID required' });
    }

    // 🔹 Convert string IDs to ObjectIds
    const projectObjectId = new mongoose.Types.ObjectId(project_id);
    const subprojectObjectId = subproject_id
      ? new mongoose.Types.ObjectId(subproject_id)
      : null;
    const resourceObjectId = resource_id
      ? new mongoose.Types.ObjectId(resource_id)
      : null;

    // 🔹 Find project
    const project = await Project.findById(projectObjectId);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // 🔹 Parse "Month Year"
    let parsedMonth = null;
    let parsedYear = null;
    if (month) {
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december',
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1;
        parsedYear = parseInt(match[2]);
      }
    }

    // 🔹 Build match conditions
    const matchConditions = {
      'billing_records.project_id': projectObjectId,
    };
    if (subprojectObjectId)
      matchConditions['billing_records.subproject_id'] = subprojectObjectId;
    if (resourceObjectId)
      matchConditions['billing_records.resource_id'] = resourceObjectId;
    if (parsedMonth) matchConditions['billing_records.month'] = parsedMonth;
    if (parsedYear) matchConditions['billing_records.year'] = parsedYear;
    if (billable_status)
      matchConditions['billing_records.billable_status'] = billable_status;
    if (productivity_level)
      matchConditions['billing_records.productivity_level'] = productivity_level;

    console.log('🧩 Match Conditions:', matchConditions);

    // 🔹 Aggregation: latest record per (project, subproject, resource)
    const results = await Invoice.aggregate([
      { $unwind: '$billing_records' },
      { $match: matchConditions },
      {
        $sort: {
          'billing_records.project_id': 1,
          'billing_records.subproject_id': 1,
          'billing_records.resource_id': 1,
          createdAt: -1,
        },
      },
      {
        $group: {
          _id: {
            project_id: '$billing_records.project_id',
            subproject_id: '$billing_records.subproject_id',
            resource_id: '$billing_records.resource_id',
          },
          latestRecord: { $first: '$billing_records' },
          invoiceCreatedAt: { $first: '$createdAt' },
        },
      },
      {
        $lookup: {
          from: 'resources',
          localField: 'latestRecord.resource_id',
          foreignField: '_id',
          as: 'resource',
        },
      },
      {
        $addFields: {
          resource: { $arrayElemAt: ['$resource', 0] },
        },
      },
    ]);

    // 🧾 No Results
    if (!results.length) {
      return res.status(200).json({
        message: 'No billing records found for this filter.',
        total_cost: 0,
        total_hours: 0,
        breakdown: [],
      });
    }

    // 🔹 Calculate totals (Non-billable => total_amount = 0)
    let total_cost = 0;
    let total_hours = 0;

    const breakdown = results.map((item) => {
      const record = item.latestRecord;

      // Billable logic
      const effectiveAmount =
        record.billable_status === 'Non-Billable' ? 0 : record.total_amount || 0;

      total_cost += effectiveAmount;
      total_hours += record.hours || 0;

      return {
        project_name: record.project_name || project.name,
        subproject_name: record.subproject_name || null,
        resource_name: item.resource?.name || record.resource_name || null,
        resource_role: item.resource?.role || null,
        productivity_level: record.productivity_level,
        hours: record.hours,
        rate: record.rate,
        flatrate: record.flatrate,
        costing: record.costing,
        total_amount: effectiveAmount, // 👈 overridden here
        billable_status: record.billable_status,
        month: record.month,
        year: record.year,
        description: record.description || null,
      };
    });

    // ✅ Final Response
    res.json({
      project_id,
      project_name: project.name,
      total_records: breakdown.length,
      total_resources: new Set(
        results.map((r) => r.latestRecord.resource_id.toString())
      ).size,
      total_hours,
      total_cost,
      breakdown,
    });
  } catch (err) {
    console.error('Error in /invoices/calculate:', err);
    res.status(500).json({ message: err.message });
  }
});





// 🧮 Utility: current month/year
const getCurrentMonthYear = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};



// ==========================================================
// 2️⃣ RESOURCE ALLOCATION STATS
// ==========================================================


router.post('/resource-allocation', async (req, res) => {
  try {
    const { month } = req.body || {};

    // 🔹 Parse month input ("October 2025" or numeric)
    let parsedMonth = null;
    let parsedYear = null;

    if (month) {
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december',
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1; // 1–12
        parsedYear = parseInt(match[2], 10);
      } else if (!isNaN(month)) {
        parsedMonth = Number(month);
      }
    }

    if (!parsedMonth || !parsedYear) {
      return res
        .status(400)
        .json({ message: 'Please provide a valid month like "October 2025".' });
    }

    // 🔹 Aggregate from invoices for that month/year
    const allocationData = await Invoice.aggregate([
      { $unwind: '$billing_records' },
      {
        $match: {
          'billing_records.month': parsedMonth,
          'billing_records.year': parsedYear,
        },
      },
      {
        $group: {
          _id: '$billing_records.resource_id',
          total_hours: { $sum: '$billing_records.hours' },
          total_cost: { $sum: '$billing_records.total_amount' },
          projects: { $addToSet: '$billing_records.project_name' },
          subprojects: { $addToSet: '$billing_records.subproject_name' },
          billable_statuses: { $addToSet: '$billing_records.billable_status' },
        },
      },
      {
        $lookup: {
          from: 'resources',
          localField: '_id',
          foreignField: '_id',
          as: 'resource',
        },
      },
      {
        $addFields: {
          resource: { $arrayElemAt: ['$resource', 0] },
        },
      },
    ]);

    // 🔹 Fetch total resources to calculate allocation ratio
    const totalResources = await Resource.countDocuments();

    const allocatedResources = allocationData.length;
    const availableResources = totalResources - allocatedResources;

    const allocationPercentage =
      totalResources > 0 ? (allocatedResources / totalResources) * 100 : 0;

    // 🔹 Build detailed breakdown
    const resource_breakdown = allocationData.map((r) => ({
      resource_id: r._id,
      name: r.resource?.name || 'Unknown Resource',
      role: r.resource?.role || null,
      total_hours: r.total_hours || 0,
      total_cost: r.total_cost || 0,
      assigned_projects: r.projects.filter(Boolean),
      assigned_subprojects: r.subprojects.filter(Boolean),
      billable_statuses: r.billable_statuses,
      utilization:
        r.total_hours > 160
          ? 'High'
          : r.total_hours > 80
          ? 'Medium'
          : 'Low',
    }));

    res.json({
      month: parsedMonth,
      year: parsedYear,
      total_resources: totalResources,
      allocated_resources: allocatedResources,
      available_resources: availableResources,
      allocation_percentage: allocationPercentage,
      resource_breakdown,
    });
  } catch (err) {
    console.error('Error in /resource-allocation:', err);
    res.status(500).json({ message: err.message });
  }
});



// ==========================================================
// 3️⃣ MONTHLY BUDGET CALCULATION
// ==========================================================

router.post('/monthly-analysis', async (req, res) => {
  try {
    const { month } = req.body || {};

    if (!month) return res.status(400).json({ message: 'Month is required.' });

    const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!match) return res.status(400).json({ message: 'Invalid month format.' });

    const monthNames = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'
    ];
    const parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1;
    const parsedYear = parseInt(match[2], 10);

    if (!parsedMonth || !parsedYear) {
      return res.status(400).json({ message: 'Invalid month or year.' });
    }

    // ✅ Step 1: Fetch all invoices that include data for that month
    const invoices = await Invoice.find({
      'billing_records.month': parsedMonth,
      'billing_records.year': parsedYear
    }).sort({ createdAt: -1 }).lean();

    if (!invoices.length) {
      return res.json({
        month,
        year: parsedYear,
        total_budget: 0,
        billable_amount: 0,
        non_billable_amount: 0,
        project_breakdown: [],
      });
    }

    // ✅ Step 2: Keep only the latest record per (project, subproject, resource)
    const seenKeys = new Set();
    const latestRecords = [];

    for (const invoice of invoices) {
      for (const record of invoice.billing_records) {
        if (record.month === parsedMonth && record.year === parsedYear) {
          const key = `${record.project_id}-${record.subproject_id}-${record.resource_id}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            latestRecords.push(record);
          }
        }
      }
    }

    if (!latestRecords.length) {
      return res.json({
        month,
        year: parsedYear,
        total_budget: 0,
        billable_amount: 0,
        non_billable_amount: 0,
        project_breakdown: [],
      });
    }

    // ✅ Step 3: Aggregate totals by project
    let total_budget = 0;
    let billable_amount = 0;
    let non_billable_amount = 0;
    const project_breakdown = {};

    for (const record of latestRecords) {
      const projectId = record.project_id?.toString();
      if (!projectId) continue;

      const amount = record.total_amount || 0;
      const costing = record.costing || 0;

      if (!project_breakdown[projectId]) {
        const project = await Project.findById(projectId).lean();
        project_breakdown[projectId] = {
          project_id: projectId,
          project_name: project?.name || 'Unknown Project',
          total_cost: 0,
          billable_cost: 0,
          non_billable_cost: 0,
          resource_count: 0,
        };
      }

      project_breakdown[projectId].total_cost += costing;
      project_breakdown[projectId].resource_count++;

      if (record.billable_status === 'Billable') {
        project_breakdown[projectId].billable_cost += amount;
        billable_amount += amount;
      } else {
        project_breakdown[projectId].non_billable_cost += costing;
        non_billable_amount += costing;
      }

      total_budget += amount;
    }

    // ✅ Step 4: Return results
    res.json({
      month,
      year: parsedYear,
      total_budget,
      billable_amount,
      non_billable_amount,
      project_breakdown: Object.values(project_breakdown),
    });

  } catch (err) {
    console.error('Error in monthly-analysis:', err);
    res.status(500).json({ message: err.message });
  }
});



// ==========================================================
// 4️⃣ CALCULATOR DASHBOARD SUMMARY
// ==========================================================
router.get('/summary', async (req, res) => {
  try {
    const total_projects = await Project.countDocuments();
    const total_resources = await Resource.countDocuments();

    // assuming "billable" means having any billing record with status 'billable'
    const billable_resources = await Billing.distinct('resource_id', {
      billable_status: 'Billable',
    }).then((ids) => ids.length);

    const { month, year } = getCurrentMonthYear();
    const current_billings = await Billing.find({ month, year });
    const current_month_total = current_billings.reduce(
      (sum, b) => sum + (b.total_amount || 0),
      0
    );

    // Average rates by productivity level
    const productivityRates = await SubprojectProductivity.aggregate([
      {
        $group: {
          _id: '$level',
          avg_rate: { $avg: '$base_rate' },
        },
      },
    ]);

    const avg_rates = {};
    productivityRates.forEach((p) => {
      avg_rates[p._id] = p.avg_rate;
    });

    res.json({
      total_projects,
      total_resources,
      billable_resources,
      current_month_billing: current_month_total,
      average_rates: avg_rates,
      utilization_rate:
        total_resources > 0 ? (billable_resources / total_resources) * 100 : 0,
    });
  } catch (err) {
    console.error('Error in summary:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
