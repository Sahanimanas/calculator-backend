  const express = require('express');
  const router = express.Router();
  const mongoose = require('mongoose');
  const Billing = require('../models/Billing');
  const Project = require('../models/Project');
  const Subproject = require('../models/Subproject.js');
  const Resource = require('../models/Resource');
  const Productivity = require('../models/SubprojectProductivity');
  const AuditLog = require('../models/AuditLog');
  // const {   getManagerUser } = require('../middleware/auth'); // auth middleware
  // const calendar = require('calendar');
  // const { body, query, param, validationResult } = require('express-validator');

  // ================= GET billing records =================
 router.get('/', async (req, res) => {
  const { project_id, subproject_id, month, year, billable_status } = req.query;

  try {
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;

    // Handle month filter
    if (month === 'null') {
      console.log('Filtering for null month');
      filters.month = { $in: [null, undefined] }; // Match missing or null
    } else if (month) {
      filters.month = parseInt(month);
    }

    // Handle year filter
    if (year) {filters.year = parseInt(year)}
    else filters.year = new Date().getFullYear();


    if (billable_status) filters.billable_status = billable_status;

    const billings = await Billing.find(filters)
      .populate('project_id', 'name')
      .populate('subproject_id', 'name')
      .sort({ created_at: -1 })
      .lean();

    const response = billings.map(b => ({
      ...b,
      project_name: b.project_id?.name || null,
      subproject_name: b.subproject_id?.name || null
    }));

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});


  // ================= CREATE billing record =================
 router.post('/', async (req, res) => {
  try {
    const {
      project_id,
      subproject_id,
      resource_id,
      productivity_level,
      flatrate,
      hours,
      rate,
      description,
      billable_status,
      month,
      year,
    } = req.body;

    // Validate project and resource existence
    const project = await Project.findById(project_id);
    const subproject = await Subproject.findById(subproject_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    const project_name = project.name;
    const subproject_name = subproject.name;

    const resource = await Resource.findById(resource_id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });
    const resource_name = resource.name;

    const billingMonth = month || new Date().getMonth() + 1;
    const billingYear = year || new Date().getFullYear();

    // ✅ Check if billing already exists for this combo
    const existingBilling = await Billing.findOne({
      project_id,
      subproject_id,
      resource_id,
      
    });
// console.log(existingBilling  )
    if (existingBilling) {
      // Option 1: Update the existing record (append new data)
      existingBilling.productivity_level =
        productivity_level || existingBilling.productivity_level;
      existingBilling.hours = hours ?? existingBilling.hours;
      existingBilling.rate = rate ?? existingBilling.rate;
      existingBilling.costing =
        (hours ?? existingBilling.hours) * (rate ?? existingBilling.rate);
        existingBilling.total_amount =
        (hours ?? existingBilling.hours) * (rate ?? existingBilling.flatrate);
      existingBilling.month = billingMonth;
      existingBilling.year = billingYear;
      existingBilling.billable_status =
        billable_status || existingBilling.billable_status;
      existingBilling.description = description || existingBilling.description;

      await existingBilling.save();

      return res.status(200).json({
        message: 'Existing billing record updated successfully',
        billing: existingBilling,
      });
    }

    // ✅ If no record found, create a new billing entry
    const newBilling = new Billing({
      project_id,
      subproject_id,
      resource_id,
      project_name,
      subproject_name,
      resource_name,
      month: billingMonth,
      flatrate: flatrate || 0,
      year: billingYear,
      resource_name: resource.name,
      resource_role: resource.role,
      productivity_level: productivity_level || 'Low',
      hours: hours || 0,
      rate: rate || 0,
      total_amount: (hours || 0) * (rate || 0),
      billable_status: billable_status || 'Billable',
      description: description || null,
    });

    await newBilling.save();

    return res.status(201).json({
      message: 'New billing record created successfully',
      billing: newBilling,
    });
  } catch (err) {
    console.error('Billing creation error:', err);
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});


  // ================= AUTO-GENERATE billing =================
  router.post(
    '/auto-generate',
    
    async (req, res) => {
      try {
        const { resource_id } = req.body;

        const resource = await Resource.findById(resource_id);
        if (!resource) return res.status(404).json({ message: 'Resource not found' });

        if (!resource.assigned_projects?.length)
          return res.status(400).json({ message: 'No assigned projects for this resource' });

        const currentMonth = new Date().getUTCMonth() + 1;
        const currentYear = new Date().getUTCFullYear();
        const createdBillings = [];

        for (const projectId of resource.assigned_projects) {
          const project = await Project.findById(projectId);
          if (!project) continue;

          // Check existing billing
          const existing = await Billing.findOne({
            project_id: projectId,
            resource_id,
            month: currentMonth,
            year: currentYear
          });
          if (existing) continue;

          const billing = new Billing({
            project_id: projectId,
            subproject_id: null,
            resource_id,
            month: currentMonth,
            year: currentYear,
            resource_name: resource.name,
            resource_role: resource.role,
            productivity_level: 'Default',
            hours: 0,
            rate: 0,
            total_amount: 0,
            billable_status: 'Billable',
            description: `Auto-generated billing for ${resource.name}`
          });

          await billing.save();
          createdBillings.push(billing);

          // Subprojects
          for (const subId of resource.assigned_subprojects || []) {
            const sub = await Subproject.findById(subId);
            if (!sub || !sub. project_id.equals(projectId)) continue;

            const subBilling = new Billing({
              project_id: projectId,
              subproject_id: subId,
              resource_id,
              month: currentMonth,
              year: currentYear,
              resource_name: resource.name,
              resource_role: resource.role,
              productivity_level: 'Default',
              hours: 0,
              rate: 0,
              total_amount: 0,
              billable_status: 'Billable',
              description: `Auto-generated billing for subproject ${sub.name}`
            });

            await subBilling.save();
            createdBillings.push(subBilling);
          }
        }

        if (!createdBillings.length) return res.status(400).json({ message: 'No new billings created.' });

        res.json(createdBillings);
      } catch (err) {
        console.error(err);
        res.status(500).json({ message: err.message });
      }
    }
  );

  // ================= UPDATE billing =================
  router.put('/:billing_id',   async (req, res) => {
    try {
      const billing = await Billing.findById(req.params.billing_id);
      if (!billing) return res.status(404).json({ message: 'Billing not found' });

      Object.assign(billing, req.body);

      if (req.body.hours || req.body.flatrate ) {
        billing.total_amount = (billing.hours || 0) * (billing.flatrate || 0);
        billing.costing = (billing.hours || 0) * (billing.rate || 0);
      }


      await billing.save();

      // await AuditLog.create({
      //   user_id: req.user._id,
      //   action: 'UPDATE',
      //   entity_type: 'Billing',
      //   entity_id: billing._id,
      //   description: `User ${req.user.email} updated billing for ${billing.resource_name}`,
      //   details: req.body
      // });

      res.json(billing);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  });

  // ================= DELETE billing =================
  router.delete('/:billing_id',   async (req, res) => {
    try {
      const billing = await Billing.findById(req.params.billing_id);
      if (!billing) return res.status(404).json({ message: 'Billing not found' });

      // await AuditLog.create({
      //   user_id: req.user._id,
      //   action: 'DELETE',
      //   entity_type: 'Billing',
      //   entity_id: billing._id,
      //   description: `User ${req.user.email} deleted billing for ${billing.resource_name}`,
      //   details: { deleted_amount: billing.total_amount }
      // });

      await billing.deleteOne();

      res.json({ message: 'Billing deleted successfully', success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  });

  // ================= SUMMARY =================
  router.get('/summary',   async (req, res) => {
    try {
      const { month, year, project_id } = req.query;

      const filters = {};
      if (month) filters.month = parseInt(month);
      if (year) filters.year = parseInt(year);
      if (project_id) filters.project_id = project_id;

      const billings = await Billing.find(filters);

      const totalBillable = billings.filter(b => b.billable_status === 'Billable')
        .reduce((acc, b) => acc + (b.total_amount || 0), 0);

      const totalNonBillable = billings.filter(b => b.billable_status === 'Non-Billable')
        .reduce((acc, b) => acc + (b.total_amount || 0), 0);

      const totalBillableHours = billings.filter(b => b.billable_status === 'Billable')
        .reduce((acc, b) => acc + (b.hours || 0), 0);

      const totalNonBillableHours = billings.filter(b => b.billable_status === 'Non-Billable')
        .reduce((acc, b) => acc + (b.hours || 0), 0);

      res.json({
        client_billable_total: totalBillable,
        internal_cost: totalNonBillable,
        grand_total: totalBillable + totalNonBillable,
        billable_hours: totalBillableHours,
        non_billable_hours: totalNonBillableHours,
        total_hours: totalBillableHours + totalNonBillableHours,
        record_count: billings.length
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  });

  // ================= CALCULATE billing =================
  router.post('/calculate',   async (req, res) => {
    try {
      const { project_id, subproject_id, resource_id, productivity_level, hours, rate } = req.body;

      let finalRate = rate || 0;
      if (resource_id && productivity_level) {
        const prod = await Productivity.findOne({
          project_id,
          subproject_id,
          level: productivity_level
        });
        if (prod) finalRate = prod.base_rate || finalRate;
      }

      const total = (hours || 0) * finalRate;
      const formula = `$${finalRate.toFixed(2)} × ${hours || 0} hours = $${total.toFixed(2)}`;

      res.json({ total, rate: finalRate, hours: hours || 0, formula });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err.message });
    }
  });

  module.exports = router;
