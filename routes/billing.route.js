// routes/billing.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Billing = require('../models/Billing');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const Resource = require('../models/Resource');
const Productivity = require('../models/SubprojectProductivity');
const AuditLog = require('../models/AuditLog');

// ================= GET billing records (Standard) =================
router.get('/', async (req, res) => {
  const { project_id, subproject_id, month, year, billable_status } = req.query;

  try {
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;

    // Handle month filter
    if (month === 'null') {
      filters.month = { $in: [null, undefined] }; // Match missing or null
    } else if (month) {
      filters.month = parseInt(month);
    }

    // Handle year filter
    if (year) { filters.year = parseInt(year) }
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

// ================= GET PAGINATED BILLING DATA =================
// routes/billing.js

// ================= GET PAGINATED BILLING WITH RESOURCE ASSIGNMENTS =================
// routes/billing.js

// ================= GET PAGINATED BILLING WITH RESOURCE ASSIGNMENTS =================
router.get('/paginated', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      month,
      year,
      project_id,
      subproject_id,
      search,
      sort_by = 'resource_name',
      sort_order = 'ascending',
      show_non_billable = 'true'
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // ============================================
    // STEP 1: Get all active resource assignments
    // ============================================
    let resourceQuery = {};
    
    if (subproject_id) {
      resourceQuery['assigned_subprojects._id'] = subproject_id;
    } else if (project_id) {
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      const subprojectIds = subprojects.map(sp => sp._id);
      resourceQuery['assigned_subprojects._id'] = { $in: subprojectIds };
    }

    if (search && search.trim()) {
      resourceQuery.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const resources = await Resource.find(resourceQuery)
      .populate('assigned_subprojects', 'name flatrate project_id')
      .lean();

    // ============================================
    // STEP 2: Build resource-subproject pairs
    // ============================================
    const resourceSubprojectPairs = [];
    const uniqueSubprojectIds = new Set();
    
    for (const resource of resources) {
      for (const subproject of resource.assigned_subprojects || []) {
        if (subproject_id && subproject._id.toString() !== subproject_id) continue;
        if (project_id && subproject.project_id && subproject.project_id.toString() !== project_id) continue;

        resourceSubprojectPairs.push({
          resource_id: resource._id,
          resource_name: resource.name,
          resource_email: resource.email,
          resource_role: resource.role,
          resource_avatar: resource.avatar_url,
          subproject_id: subproject._id,
          subproject_name: subproject.name,
          subproject_flatrate: subproject.flatrate || 0,
          project_id: subproject.project_id
        });
        
        uniqueSubprojectIds.add(subproject._id.toString());
      }
    }

    // ============================================
    // STEP 3: Fetch productivity ONLY for mapped subprojects
    // ============================================
    const subprojectIdsArray = Array.from(uniqueSubprojectIds);
    const productivityRates = await Productivity.find({
      subproject_id: { $in: subprojectIdsArray }
    }).lean();

    // Create productivity map by subproject_id
    const productivityMap = new Map();
    productivityRates.forEach(rate => {
      const spId = rate.subproject_id.toString();
      if (!productivityMap.has(spId)) {
        productivityMap.set(spId, []);
      }
      productivityMap.get(spId).push(rate);
    });

    // ============================================
    // STEP 4: Validate productivity rates exist
    // ============================================
    const missingProductivity = [];
    for (const spId of uniqueSubprojectIds) {
      if (!productivityMap.has(spId)) {
        const subproject = await Subproject.findById(spId).select('name').lean();
        missingProductivity.push({
          subproject_id: spId,
          subproject_name: subproject?.name || 'Unknown'
        });
      }
    }

    // Return error if any subproject is missing productivity rates
    if (missingProductivity.length > 0) {
      return res.status(400).json({
        message: 'Productivity rates missing for assigned subprojects',
        missing_productivity: missingProductivity,
        error_type: 'MISSING_PRODUCTIVITY'
      });
    }

    // ============================================
    // STEP 5: Fetch billing records
    // ============================================
    const billingQuery = {
      month: month === 'null' ? null : parseInt(month),
      year: parseInt(year)
    };

    if (subproject_id) {
      billingQuery.subproject_id = subproject_id;
    } else if (project_id) {
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      billingQuery.subproject_id = { $in: subprojects.map(sp => sp._id) };
    }

    const resourceIds = [...new Set(resourceSubprojectPairs.map(p => p.resource_id.toString()))];
    if (resourceIds.length > 0) {
      billingQuery.resource_id = { $in: resourceIds };
    }

    const billingRecords = await Billing.find(billingQuery)
      .populate('project_id', 'name')
      .lean();

    const billingMap = new Map();
    billingRecords.forEach(billing => {
      const key = `${billing.resource_id}-${billing.subproject_id}`;
      billingMap.set(key, billing);
    });

    // ============================================
    // STEP 6: Fetch project info (batch fetch)
    // ============================================
    const uniqueProjectIds = [...new Set(
      resourceSubprojectPairs
        .filter(p => p.project_id)
        .map(p => p.project_id.toString())
    )];
    
    const projects = await Project.find({
      _id: { $in: uniqueProjectIds }
    }).select('name').lean();
    
    const projectMap = new Map(projects.map(p => [p._id.toString(), p]));

    // ============================================
    // STEP 7: Merge pairs with billing data
    // ============================================
    const mergedData = resourceSubprojectPairs.map((pair) => {
      const key = `${pair.resource_id}-${pair.subproject_id}`;
      const billing = billingMap.get(key);
      const projectInfo = projectMap.get(pair.project_id?.toString());
      
      // Get productivity rates for THIS specific subproject
      const rates = productivityMap.get(pair.subproject_id.toString()) || [];
      
      const defaultProductivity = 'Medium';
      const defaultRate = rates.find(
        r => r.level.toLowerCase() === defaultProductivity.toLowerCase()
      )?.base_rate || 0;

      if (billing) {
        // Has billing record
        const currentRate = rates.find(
          r => r.level.toLowerCase() === (billing.productivity_level || '').toLowerCase()
        )?.base_rate || billing.rate || 0;

        return {
          uniqueId: `${pair.project_id}-${pair.subproject_id}-${pair.resource_id}`,
          _id: pair.resource_id,
          billingId: billing._id,
          isMonthlyRecord: billing.month !== null,
          
          name: pair.resource_name,
          email: pair.resource_email,
          role: pair.resource_role,
          avatar_url: pair.resource_avatar,
          
          projectId: pair.project_id,
          projectName: projectInfo?.name || 'Unknown',
          subprojectId: pair.subproject_id,
          subProjectName: pair.subproject_name,
          
          hours: billing.hours || 0,
          rate: currentRate,
          flatrate: pair.subproject_flatrate,
          productivity: billing.productivity_level || defaultProductivity,
          description: billing.description || '',
          isBillable: billing.billable_status === 'Billable',
          
          costing: (billing.hours || 0) * currentRate,
          totalBill: (billing.hours || 0) * pair.subproject_flatrate,
          
          isEditable: true
        };
      } else {
        // No billing record - show with 0 hours
        return {
          uniqueId: `${pair.project_id}-${pair.subproject_id}-${pair.resource_id}`,
          _id: pair.resource_id,
          billingId: null,
          isMonthlyRecord: false,
          
          name: pair.resource_name,
          email: pair.resource_email,
          role: pair.resource_role,
          avatar_url: pair.resource_avatar,
          
          projectId: pair.project_id,
          projectName: projectInfo?.name || 'Unknown',
          subprojectId: pair.subproject_id,
          subProjectName: pair.subproject_name,
          
          hours: 0,
          rate: defaultRate,
          flatrate: pair.subproject_flatrate,
          productivity: defaultProductivity,
          description: '',
          isBillable: true,
          
          costing: 0,
          totalBill: 0,
          
          isEditable: true
        };
      }
    });

    // ============================================
    // STEP 8: Filter, Sort, Paginate
    // ============================================
    let filteredData = mergedData;
    if (show_non_billable === 'false') {
      filteredData = mergedData.filter(item => item.isBillable);
    }

    const sortDirection = sort_order === 'descending' ? -1 : 1;
    const sortFieldMap = {
      'resource': 'name',
      'projectName': 'projectName',
      'subProjectName': 'subProjectName',
      'totalbill': 'totalBill',
      'costing': 'costing',
      'hours': 'hours',
      'rate': 'rate',
      'flatrate': 'flatrate',
      'productivity': 'productivity'
    };
    
    const sortField = sortFieldMap[sort_by] || 'name';
    
    filteredData.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      if (typeof aVal === 'string') {
        return sortDirection * aVal.localeCompare(bVal);
      }
      return sortDirection * (aVal - bVal);
    });

    const total = filteredData.length;
    const paginatedData = filteredData.slice(skip, skip + limitNum);

    res.json({
      records: paginatedData,
      total,
      page: pageNum,
      totalPages: Math.ceil(total / limitNum),
      hasMore: pageNum < Math.ceil(total / limitNum)
    });

  } catch (err) {
    console.error('Error in paginated billing:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET TOTALS FOR CURRENT FILTERS =================
// ================= GET TOTALS (ONLY ACTUAL BILLING RECORDS) =================
router.get('/totals', async (req, res) => {
  try {
    const { month, year, project_id, subproject_id, show_non_billable = 'true' } = req.query;

    const query = {
      month: month === 'null' ? null : parseInt(month),
      year: parseInt(year)
    };
    
    if (project_id) {
      // Get all subprojects under this project
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      query.subproject_id = { $in: subprojects.map(sp => sp._id) };
    } else if (subproject_id) {
      query.subproject_id = subproject_id;
    }

    const pipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $cond: [
                { $eq: ['$billable_status', 'Billable'] },
                '$total_amount',
                0
              ]
            }
          },
          totalCost: { $sum: '$costing' },
          totalRecords: { $sum: 1 },
          billableRecords: {
            $sum: {
              $cond: [{ $eq: ['$billable_status', 'Billable'] }, 1, 0]
            }
          }
        }
      }
    ];

    const result = await Billing.aggregate(pipeline);
    
    const totals = result[0] || {
      totalRevenue: 0,
      totalCost: 0,
      totalRecords: 0,
      billableRecords: 0
    };

    res.json({
      revenue: totals.totalRevenue,
      cost: totals.totalCost,
      profit: totals.totalRevenue - totals.totalCost,
      totalRecords: totals.totalRecords,
      billableRecords: totals.billableRecords
    });

  } catch (err) {
    console.error('Error calculating totals:', err);
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

    // Validate project and resource
    const project = await Project.findById(project_id);
    const subproject = await Subproject.findById(subproject_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    
    const resource = await Resource.findById(resource_id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    const billingMonth = month || new Date().getMonth() + 1;
    const billingYear = year || new Date().getFullYear();

    // Check existing
    const existingBilling = await Billing.findOne({
      project_id,
      subproject_id,
      resource_id,
      month: billingMonth,
      year: billingYear
    });

    if (existingBilling) {
      existingBilling.productivity_level = productivity_level || existingBilling.productivity_level;
      existingBilling.hours = hours ?? existingBilling.hours;
      existingBilling.rate = rate ?? existingBilling.rate;
      existingBilling.flatrate = flatrate ?? existingBilling.flatrate;
      existingBilling.costing = (hours ?? existingBilling.hours) * (rate ?? existingBilling.rate);
      existingBilling.total_amount = (hours ?? existingBilling.hours) * (existingBilling.flatrate);
      existingBilling.billable_status = billable_status || existingBilling.billable_status;
      existingBilling.description = description || existingBilling.description;

      await existingBilling.save();
      return res.status(200).json({ message: 'Updated successfully', billing: existingBilling });
    }

    // Create new
    const newBilling = new Billing({
      project_id,
      subproject_id,
      resource_id,
      project_name: project.name,
      subproject_name: subproject ? subproject.name : '',
      resource_name: resource.name,
      resource_role: resource.role,
      month: billingMonth,
      year: billingYear,
      flatrate: flatrate || 0,
      productivity_level: productivity_level || 'Low',
      hours: hours || 0,
      rate: rate || 0,
      costing: (hours || 0) * (rate || 0),
      total_amount: (hours || 0) * (flatrate || 0),
      billable_status: billable_status || 'Billable',
      description: description || null,
    });

    await newBilling.save();
    return res.status(201).json({ message: 'Created successfully', billing: newBilling });
  } catch (err) {
    console.error('Billing creation error:', err);
    return res.status(500).json({ message: 'Internal Server Error', error: err.message });
  }
});

// ================= BULK UPDATE BILLING RECORDS =================
router.patch('/bulk-update', async (req, res) => {
  try {
    const { updates } = req.body;
    
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ message: 'Updates array is required' });
    }

    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const { billingId, isMonthlyRecord, ...fields } = update;
        
        // Prepare numeric fields for calculation
        const hours = Number(fields.hours) || 0;
        const rate = Number(fields.rate) || 0;
        const flatrate = Number(fields.flatrate) || 0;
        
        // Map frontend booleans to Schema strings if necessary
        // Assuming frontend sends "isBillable": true/false -> Schema "Billable"/"Non-Billable"
        let billableStatus = fields.billable_status;
        if (fields.isBillable !== undefined) {
             billableStatus = fields.isBillable ? 'Billable' : 'Non-Billable';
        }

        // Map productivity if coming from frontend as 'productivity'
        const productivityLevel = fields.productivity_level || fields.productivity;

        // Base payload
        const payload = {
          hours,
          rate,
          flatrate,
          productivity_level: productivityLevel,
          billable_status: billableStatus,
          description: fields.description,
          costing: hours * rate,
          total_amount: hours * flatrate,
          // Ensure month/year are updated if passed
          month: fields.month,
          year: fields.year
        };

        let result;
        
        // UPDATE existing monthly record
        if (billingId && isMonthlyRecord && billingId !== 'undefined') {
          result = await Billing.findByIdAndUpdate(
            billingId,
            { $set: payload },
            { new: true, runValidators: true }
          );
        } 
        // CREATE new monthly record (if user edited a row that didn't have a DB entry yet)
        else {
          // We need to fetch names to populate denormalized fields
          // Frontend must send IDs: projectId, subprojectId, _id (resourceId)
          const projectId = fields.projectId || fields.project_id;
          const subprojectId = fields.subprojectId || fields.subproject_id;
          const resourceId = fields._id || fields.resource_id;

          if (!projectId || !resourceId) {
             throw new Error('Missing project_id or resource_id for new record creation');
          }

          const project = await Project.findById(projectId);
          const subproject = subprojectId ? await Subproject.findById(subprojectId) : null;
          const resource = await Resource.findById(resourceId);

          if (!project || !resource) throw new Error('Invalid Project or Resource ID');

          result = await Billing.create({
            ...payload,
            project_id: projectId,
            subproject_id: subprojectId,
            resource_id: resourceId,
            project_name: project.name,
            subproject_name: subproject ? subproject.name : '',
            resource_name: resource.name,
            resource_role: resource.role
          });
        }
        
        results.push(result);
      } catch (error) {
        errors.push({
          update,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      updated: results.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('Bulk update error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= AUTO-GENERATE billing =================
router.post('/auto-generate', async (req, res) => {
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
        subproject_id: null,
        resource_id,
        month: currentMonth,
        year: currentYear
      });
      
      if (!existing) {
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
      }

      // Subprojects
      for (const subId of resource.assigned_subprojects || []) {
        const sub = await Subproject.findById(subId);
        if (!sub || !sub.project_id.equals(projectId)) continue;

        const existingSub = await Billing.findOne({
            project_id: projectId,
            subproject_id: subId,
            resource_id,
            month: currentMonth,
            year: currentYear
        });

        if (!existingSub) {
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
    }

    if (!createdBillings.length) return res.status(400).json({ message: 'No new billings created.' });

    res.json(createdBillings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= UPDATE billing =================
router.put('/:billing_id', async (req, res) => {
  try {
    const { billing_id } = req.params;

    const billing = await Billing.findById(billing_id);
    if (!billing) {
      return res.status(404).json({ message: 'Billing not found' });
    }

    const { hours, flatrate, rate, ...rest } = req.body;

    Object.assign(billing, rest);

    if (typeof hours !== 'undefined') billing.hours = Number(hours) || 0;
    if (typeof flatrate !== 'undefined') billing.flatrate = Number(flatrate) || 0;
    if (typeof rate !== 'undefined') billing.rate = Number(rate) || 0;

    billing.total_amount = (billing.hours || 0) * (billing.flatrate || 0);
    billing.costing = (billing.hours || 0) * (billing.rate || 0);

    await billing.save();

    res.status(200).json(billing);
  } catch (err) {
    console.error('Billing update failed:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ================= DELETE billing =================
router.delete('/:billing_id', async (req, res) => {
  try {
    const billing = await Billing.findById(req.params.billing_id);
    if (!billing) return res.status(404).json({ message: 'Billing not found' });

    await billing.deleteOne();

    res.json({ message: 'Billing deleted successfully', success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================= SUMMARY =================
router.get('/summary', async (req, res) => {
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
router.post('/calculate', async (req, res) => {
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