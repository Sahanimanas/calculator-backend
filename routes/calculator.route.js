const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

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
      month,          // can be "January 2025"
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

    // Parse month string like "January 2025"
    let parsedMonth = null;
    let parsedYear = null;

    if (month) {
      // Try to parse string like "January 2025"
      const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (match) {
        const monthNames = [
          'january', 'february', 'march', 'april', 'may', 'june',
          'july', 'august', 'september', 'october', 'november', 'december'
        ];
        parsedMonth = monthNames.indexOf(match[1].toLowerCase()) + 1; // 1-12
        parsedYear = parseInt(match[2], 10);
      } else if (!isNaN(month)) {
        // if numeric month passed (like 1, 2, 3...)
        parsedMonth = Number(month);
      }
    }

    // Build filter query
    const query = { project_id };
    if (subproject_id) query.subproject_id = subproject_id;
    if (resource_id) query.resource_id = resource_id;
    if (parsedMonth) query.month = parsedMonth;
    if (parsedYear) query.year = parsedYear;
    if (billable_status) query.billable_status = billable_status;
    if (productivity_level) query.productivity_level = productivity_level;

    // Fetch filtered billing records
    const billings = await Billing.find(query)
      .populate('resource_id', 'name role')
      .populate('project_id', 'name')
      .populate('subproject_id', 'name');

    if (!billings.length) {
      return res.status(200).json({ message: 'No billing records found for this filter.' });
    }

    // Calculate totals
    let total_cost = 0;
    let total_hours = 0;
    const breakdown = [];

    for (const bill of billings) {
      total_cost += bill.total_amount || 0;
      total_hours += bill.hours || 0;

      breakdown.push({
        billing_id: bill._id,
        project_name: bill.project_id?.name,
        subproject_name: bill.subproject_id?.name,
        resource_name: bill.resource_id?.name,
        resource_role: bill.resource_id?.role,
        productivity_level: bill.productivity_level,
        hours: bill.hours,
        rate: bill.rate,
        cost: bill.total_amount,
        billable_status: bill.billable_status,
        month: bill.month,
        year: bill.year,
        description: bill.description || null,
      });
    }

    res.json({
      project_id,
      project_name: project.name,
      total_records: billings.length,
      total_resources: new Set(billings.map(b => b.resource_id?._id?.toString())).size,
      total_hours,
      total_cost,
      breakdown,
    });
  } catch (err) {
    console.error('Error in /billing/calculate:', err);
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
 
    const billings = await Billing.find({month: parsedMonth, year: parsedYear});
    
    let total_budget = 0;
    let billable_amount = 0;
    let non_billable_amount = 0;
    const project_breakdown = {};

    for (const record of billings) {
      total_budget += record.total_amount || 0;

      if (record.billable_status === 'Billable') {
        billable_amount += record.total_amount || 0;
      } else {
        non_billable_amount += record.total_amount || 0;
      }

      const projectId = record.project_id?.toString();
    //   console.log(projectId)
      if (!project_breakdown[projectId]) {
        const project = await Project.findById(record.project_id);
        project_breakdown[projectId] = {
          project_id: projectId,
          project_name: project?.name || 'Unknown Project',
          total_cost: 0,
          billable_cost: 0,
          non_billable_cost: 0,
          resource_count: 0,
        };
      }

      project_breakdown[projectId].total_cost += record.total_amount || 0;
      project_breakdown[projectId].resource_count++;

      if (record.billable_status === 'Billable') {
        project_breakdown[projectId].billable_cost += record.total_amount || 0;
      } else {
        project_breakdown[projectId].non_billable_cost += record.total_amount || 0;
      }
    }

    res.json({
      month,
      parsedYear,
      total_budget,
      billable_amount,
      non_billable_amount,
      project_breakdown: Object.values(project_breakdown),
    });
  } catch (err) {
    console.error('Error in monthly budget calc:', err);
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
