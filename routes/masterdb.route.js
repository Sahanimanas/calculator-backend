const express = require('express');
const router = express.Router();
const SubprojectProductivity = require('../models/SubprojectProductivity');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const AuditLog = require('../models/AuditLog');
const  Billing = require('../models/Billing');
const  User  = require('../models/User');
const Resource = require('../models/Resource');
const mongoose = require('mongoose');
const dayjs = require('dayjs');

const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);  
/* -----------------------------
   /projects
--------------------------------*/
router.get('/projects', async (req, res) => {
  try {
    const { visibility, search, sort_by = 'created_at', sort_order = 'desc' } = req.query;

    let query = {};
    if (visibility) query.visibility = visibility;
    if (search) query.name = { $regex: search, $options: 'i' };

    const sortField = ['name', 'created_on'].includes(sort_by) ? sort_by : 'created_on';
    const sortOrder = sort_order === 'asc' ? 1 : -1;

    const projects = await Project.find(query).sort({ [sortField]: sortOrder }).lean();

    const result = await Promise.all(
      projects.map(async (p) => {
        const creator = await User.findById(p.created_by).select('full_name');
        const subCount = await Subproject.countDocuments({ parent_project_id: p._id });

        return {
          id: p._id,
          name: p.name,
          description: p.description || '-',
          visibility: p.visibility,
          created_on: dayjs(p.created_on).format('YYYY-MM-DD HH:mm'),
          created_by: creator?.full_name || 'Unknown',
          sub_projects_count: subCount,
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ message: err.message });
  }
});

/* -----------------------------
   /sub-projects
--------------------------------*/
router.get('/sub-projects', async (req, res) => {
  try {
    const { project_id, status, search, sort_by = 'created_on', sort_order = 'desc' } = req.query;

    let query = {};
    if (project_id) query.parent_project_id = project_id;
    if (status) query.status = status;
    if (search) query.name = { $regex: search, $options: 'i' };

    const sortField = ['name', 'created_on'].includes(sort_by) ? sort_by : 'created_on';
    const sortOrder = sort_order === 'asc' ? 1 : -1;

    const subs = await Subproject.find(query).sort({ [sortField]: sortOrder }).lean();

    const result = await Promise.all(
      subs.map(async (sp) => {
        const parent = await Project.findById(sp.parent_project_id).select('name');
        const creator = await User.findById(sp.created_by).select('full_name');
        return {
          id: sp._id,
          parent_project: parent?.name || 'Unknown',
          name: sp.name,
          description: sp.description || '-',
          status: sp.status,
          created_on: dayjs(sp.created_on).format('YYYY-MM-DD HH:mm'),
          created_by: creator?.full_name || 'Unknown',
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Error fetching subprojects:', err);
    res.status(500).json({ message: err.message });
  }
});

/* -----------------------------
   /resources
--------------------------------*/
router.get('/resources', async (req, res) => {
  try {
    const { role, billable_status, search, sort_by = 'created_at', sort_order = 'desc' } = req.query;

    const query = {};
    if (role) query.role = role;
    if (billable_status) query.billable_status = billable_status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const sortField = ['name', 'role', 'created_at'].includes(sort_by) ? sort_by : 'created_at';
    const sortOrder = sort_order === 'asc' ? 1 : -1;

    const resources = await Resource.find(query).sort({ [sortField]: sortOrder }).lean();

    const result = await Promise.all(
      resources.map(async (r) => {
        const projects = await Project.find({ _id: { $in: r.assigned_projects } }).select('name');
        return {
          id: r._id,
          name: r.name,
          role: r.role,
          email: r.email,
          assigned_projects:
            projects.length > 0 ? projects.map((p) => p.name).join(', ') : '-',
          billable_status: r.billable_status,
          inherited: r.billable_inherited ? 'Yes' : 'No',
          created_at: dayjs(r.created_on).format('YYYY-MM-DD HH:mm'),
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Error fetching resources:', err);
    res.status(500).json({ message: err.message });
  }
});

/* -----------------------------
   /productivity-mapping
--------------------------------*/
router.get('/productivity-mapping', async (req, res) => {
  try {
    const { project_id, level, billable_default, sort_by = 'created_at', sort_order = 'desc' } =
      req.query;

    const query = {};
    if (project_id) query.project_id = project_id;
    if (level) query.level = level;
    if (billable_default !== undefined)
      query.billable_default = billable_default === 'true';

    const sortField = ['level', 'base_rate', 'created_at'].includes(sort_by)
      ? sort_by
      : 'created_at';
    const sortOrder = sort_order === 'asc' ? 1 : -1;

    const tiers = await SubprojectProductivity.find(query).sort({ [sortField]: sortOrder }).lean();

    const result = await Promise.all(
      tiers.map(async (t) => {
        const project = await Project.findById(t.project_id).select('name');
        const sub = t.subproject_id
          ? await Subproject.findById(t.subproject_id).select('name')
          : null;
        return {
          id: t._id,
          project: project?.name || 'Unknown',
          sub_project: sub?.name || '-',
          level: t.productivity_level,
          base_rate: `$${t.base_rate?.toFixed(2)}`,
          billable_default: t.billable_default ? 'Yes' : 'No',
          created_at: dayjs(t.created_at).format('YYYY-MM-DD HH:mm'),
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Error fetching productivity:', err);
    res.status(500).json({ message: err.message });
  }
});

/* -----------------------------
   /billing-rates
--------------------------------*/
router.get('/billing-rates', async (req, res) => {
  try {
    const { month, year, project_id, billable_status, sort_by = 'created_at', sort_order = 'desc' } =
      req.query;

    const query = {};
    if (month) query.month = parseInt(month);
    if (year) query.year = parseInt(year);
    if (project_id) query.project_id = project_id;
    if (billable_status) query.billable_status = billable_status;

    const sortField = ['resource_name', 'rate', 'total_amount', 'created_at'].includes(sort_by)
      ? sort_by
      : 'created_at';
    const sortOrder = sort_order === 'asc' ? 1 : -1;

    const billings = await Billing.find(query).sort({ [sortField]: sortOrder }).lean();

    const result = await Promise.all(
      billings.map(async (b) => {
        const project = await Project.findById(b.project_id).select('name');
        const sub = b.subproject_id
          ? await Subproject.findById(b.subproject_id).select('name')
          : null;

        return {
          id: b._id,
          project: project?.name || 'Unknown',
          sub_project: sub?.name || '-',
          resource_name: b.resource_name,
          resource_role: b.resource_role,
          productivity_level: b.productivity_level,
          month_year: `${b.month.toString().padStart(2, '0')}/${b.year}`,
          hours: b.hours?.toFixed(1),
          rate: `$${b.rate?.toFixed(2)}`,
          total_amount: `$${b.total_amount?.toFixed(2)}`,
          billable_status: b.billable_status,
          created_at: dayjs(b.created_on).format('YYYY-MM-DD HH:mm'),
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error('Error fetching billing:', err);
    res.status(500).json({ message: err.message });
  }
});

/* -----------------------------
   /summary/stats
--------------------------------*/
router.get('/summary/stats', async (req, res) => {
  try {
    const [totalProjects, totalSubs, totalRes, totalProd, totalBills] = await Promise.all([
      Project.countDocuments(),
      Subproject.countDocuments(),
      Resource.countDocuments(),
      SubprojectProductivity.countDocuments(),
      Billing.countDocuments(),
    ]);

    const [visibleProjects, activeSubs, billableRes] = await Promise.all([
      Project.countDocuments({ visibility: 'Visible' }),
      Subproject.countDocuments({ status: 'Active' }),
      Resource.countDocuments({ billable_status: 'Billable' }),
    ]);

    const recentUpdates = await AuditLog.countDocuments({
      createdAt: { $gte: new Date().setHours(0, 0, 0, 0) },
    });

    res.json({
      total_projects: totalProjects,
      visible_projects: visibleProjects,
      total_sub_projects: totalSubs,
      active_sub_projects: activeSubs,
      total_resources: totalRes,
      billable_resources: billableRes,
      total_productivity_tiers: totalProd,
      total_billing_records: totalBills,
      recent_updates_today: recentUpdates,
      last_sync: dayjs().utc().format('HH:mm [UTC]'),
    });
  } catch (err) {
    console.error('Error fetching summary stats:', err);
    res.status(500).json({ message: err.message });
  }
});
router.get('/dashboard-stats', async (req, res) => {
  try {
    // Run parallel counts for performance
    const [
      totalProjects,
      visibleProjects,
      totalSubProjects,
      activeSubProjects,
      totalResources,
      billableResources,
      totalProductivityTiers,
      totalBillingRecords,
      updatesToday,
    ] = await Promise.all([
      Project.countDocuments(),
      Project.countDocuments({ visibility: 'Visible' }),
      Subproject.countDocuments(),
      Subproject.countDocuments({ status: 'Active' }),
      Resource.countDocuments(),
      Resource.countDocuments({ billable_status: 'Billable' }),
      SubprojectProductivity.countDocuments(),
      Billing.countDocuments(),
      AuditLog.countDocuments({
        createdAt: { $gte: new Date().setHours(0, 0, 0, 0) },
      }),
    ]);

    const response = {
      projects: {
        total: totalProjects,
        visible: visibleProjects,
      },
      sub_projects: {
        total: totalSubProjects,
        active: activeSubProjects,
      },
      resources: {
        total: totalResources,
        billable: billableResources,
      },
      productivity_tiers: {
        total: totalProductivityTiers,
        label: 'Current rates',
      },
      billing_records: {
        total: totalBillingRecords,
        label: 'All time',
      },
      updates_today: {
        total: updatesToday,
        last_sync: dayjs().utc().format('HH:mm [UTC]'),
      },
    };

    res.json(response);
  } catch (err) {
    console.error('Error generating dashboard stats:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});
module.exports = router;