const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Invoice = require('../models/Invoices.js')
const Billing = require('../models/Billing');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const Resource = require('../models/Resource');

/**
 * POST /billing/calculate
 * Read-only API: Returns billing breakdown filtered by project, subproject, resource, month, year, etc.
 */
router.post('/calculate', async (req, res) => {
  try {
    const {
      project_id,
      subproject_id,
      resource_id,
      month, // can be "January 2025"
      billable_status,
      productivity_level
    } = req.body;

    if (!project_id) {
      return res.status(400).json({ message: 'Project ID required' });
    }

    const project = await Project.findById(project_id);
    if (!project) {
      return res.status(404).json({ message: 'Project not found' });
    }

    // 🔹 Parse month string like "January 2025"
    let parsedMonth = null;
    let parsedYear = null;

    if (month) {
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december'
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1; // 1–12
        parsedYear = parseInt(match[2], 10);
      } else if (!isNaN(month)) {
        parsedMonth = Number(month);
      }
    }

    // 🔹 Build filter conditions for embedded billing_records
    const matchConditions = {
      'billing_records.project_id': project_id
    };

    if (subproject_id) matchConditions['billing_records.subproject_id'] = subproject_id;
    if (resource_id) matchConditions['billing_records.resource_id'] = resource_id;
    if (parsedMonth) matchConditions['billing_records.month'] = parsedMonth;
    if (parsedYear) matchConditions['billing_records.year'] = parsedYear;
    if (billable_status) matchConditions['billing_records.billable_status'] = billable_status;
    if (productivity_level) matchConditions['billing_records.productivity_level'] = productivity_level;

    // 🔹 Fetch invoices and unwind billing records
    const results = await Invoice.aggregate([
      { $unwind: '$billing_records' },
      { $match: matchConditions },
      {
        $lookup: {
          from: 'projects',
          localField: 'billing_records.project_id',
          foreignField: '_id',
          as: 'project'
        }
      },
      {
        $lookup: {
          from: 'subprojects',
          localField: 'billing_records.subproject_id',
          foreignField: '_id',
          as: 'subproject'
        }
      },
      {
        $lookup: {
          from: 'resources',
          localField: 'billing_records.resource_id',
          foreignField: '_id',
          as: 'resource'
        }
      },
      {
        $addFields: {
          'project': { $arrayElemAt: ['$project', 0] },
          'subproject': { $arrayElemAt: ['$subproject', 0] },
          'resource': { $arrayElemAt: ['$resource', 0] }
        }
      }
    ]);

    if (!results.length) {
      return res.status(200).json({ message: 'No billing records found for this filter.' });
    }

    // 🔹 Calculate totals
    let total_cost = 0;
    let total_hours = 0;

    const breakdown = results.map(item => {
      const record = item.billing_records;
      total_cost += record.total_amount || 0;
      total_hours += record.hours || 0;

      return {
        project_name: record.project_name || item.project?.name,
        subproject_name: record.subproject_name || item.subproject?.name,
        resource_name: record.resource_name || item.resource?.name,
        resource_role: item.resource?.role || null,
        productivity_level: record.productivity_level,
        hours: record.hours,
        rate: record.rate,
        flatrate: record.flatrate,
        costing: record.costing,
        total_amount: record.total_amount,
        billable_status: record.billable_status,
        month: record.month,
        year: record.year,
        description: record.description || null
      };
    });

    // 🔹 Respond with summary
    res.json({
      project_id,
      project_name: project.name,
      total_records: breakdown.length,
      total_resources: new Set(results.map(r => r.billing_records.resource_id.toString())).size,
      total_hours,
      total_cost,
      breakdown
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

    // Parse month like "January 2025"
    let parsedMonth = null;
    let parsedYear = null;

    if (month) {
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december'
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1; // 1–12
        parsedYear = parseInt(match[2], 10);
      } else if (!isNaN(month)) {
        parsedMonth = Number(month);
      }
    }

    // Fetch all resources
    const resources = await Resource.find()
      .populate('assigned_projects', 'name')
      .populate('assigned_subprojects', 'name');

    const total_resources = resources.length;
    const allocated_resources = resources.filter(
      (r) => r.assigned_projects.length > 0 || r.assigned_subprojects.length > 0
    ).length;
    const available_resources = total_resources - allocated_resources;

    const allocation_percentage =
      total_resources > 0 ? (allocated_resources / total_resources) * 100 : 0;

    // Build detailed breakdown
    const resource_breakdown = resources.map((r) => ({
      resource_id: r._id,
      name: r.name,
      role: r.role,
      assigned_projects: r.assigned_projects.map((p) => p.name),
      assigned_subprojects: r.assigned_subprojects.map((sp) => sp.name),
      utilization:
        r.assigned_projects.length > 2
          ? 'High'
          : r.assigned_projects.length > 0
          ? 'Medium'
          : 'Low',
    }));

    res.json({
      month: parsedMonth,
      year: parsedYear,
      total_resources,
      available_resources,
      allocated_resources,
      allocation_percentage,
      resource_breakdown,
    });
  } catch (err) {
    console.error('Error in resource allocation:', err);
    res.status(500).json({ message: err.message });
  }
});


// ==========================================================
// 3️⃣ MONTHLY BUDGET CALCULATION
// ==========================================================

router.post('/monthly-analysis', async (req, res) => {
  try {
    const { month } = req.body || {};

    // --- Parse "January 2025" or numeric month/year ---
    let parsedMonth = null;
    let parsedYear = null;

    if (month) {
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december'
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1; // 1–12
        parsedYear = parseInt(match[2], 10);
      } else if (!isNaN(month)) {
        parsedMonth = Number(month);
      }
    }

    if (!parsedMonth || !parsedYear) {
      return res.status(400).json({ message: 'Invalid or missing month/year.' });
    }

    // ✅ Step 1: Fetch only the *latest* invoice per project
    const latestInvoices = await Invoice.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$project_id',
          latestInvoice: { $first: '$$ROOT' },
        },
      },
    ]);

    if (!latestInvoices.length) {
      return res.json({
        month,
        parsedYear,
        total_budget: 0,
        billable_amount: 0,
        non_billable_amount: 0,
        project_breakdown: [],
      });
    }

    // ✅ Step 2: Extract billing_records for the given month/year only
    const billingRecords = latestInvoices.flatMap(group =>
      group.latestInvoice.billing_records.filter(
        r => r.month === parsedMonth && r.year === parsedYear
      )
    );

    if (!billingRecords.length) {
      return res.json({
        month,
        parsedYear,
        total_budget: 0,
        billable_amount: 0,
        non_billable_amount: 0,
        project_breakdown: [],
      });
    }

    // ✅ Step 3: Aggregate project-wise totals
    let total_budget = 0;
    let billable_amount = 0;
    let non_billable_amount = 0;
    const project_breakdown = {};

    for (const record of billingRecords) {
      const amount = record.total_amount || 0;
      total_budget += amount;

      if (record.billable_status === 'Billable') {
        billable_amount += record.amount;
      } else {
        non_billable_amount += record.costing_amount;
      }

      const projectId = record.project_id?.toString();
      if (!projectId) continue;

      if (!project_breakdown[projectId]) {
        const project = await Project.findById(projectId);
        project_breakdown[projectId] = {
          project_id: projectId,
          project_name: project?.name || 'Unknown Project',
          total_cost: 0,
          billable_cost: 0,
          non_billable_cost: 0,
          resource_count: 0,
        };
      }

      project_breakdown[projectId].total_cost += amount;
      project_breakdown[projectId].resource_count++;

      if (record.billable_status === 'Billable') {
        project_breakdown[projectId].billable_cost += record.total_amount;
      } else {
        project_breakdown[projectId].non_billable_cost += amount;
      }
    }

    // ✅ Step 4: Send final structured response
    res.json({
      month,
      parsedYear,
      total_budget,
      billable_amount,
      non_billable_amount,
      project_breakdown: Object.values(project_breakdown),
    });

  } catch (err) {
    console.error('Error in monthly analysis:', err);
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
