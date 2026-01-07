// routes/billing.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Billing = require('../models/Billing');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject.js');
const Resource = require('../models/Resource');
const Productivity = require('../models/SubprojectProductivity');
const SubprojectRequestType = require('../models/SubprojectRequestType');

// ================= GET billing records (Standard) =================
router.get('/', async (req, res) => {
  const { project_id, subproject_id, month, year, billable_status, request_type } = req.query;

  try {
    const filters = {};
    if (project_id) filters.project_id = project_id;
    if (subproject_id) filters.subproject_id = subproject_id;
    if (request_type) filters.request_type = request_type;

    if (month === 'null') {
      filters.month = { $in: [null, undefined] };
    } else if (month) {
      filters.month = parseInt(month);
    }

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

// ================= GET PAGINATED BILLING WITH RESOURCE ASSIGNMENTS & REQUEST TYPES =================
router.get('/paginated', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      month,
      year,
      project_id,
      subproject_id,
      request_type,
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
      resourceQuery.assigned_subprojects = new mongoose.Types.ObjectId(subproject_id);
    } else if (project_id) {
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      const subprojectIds = subprojects.map(sp => sp._id);
      resourceQuery.assigned_subprojects = { $in: subprojectIds };
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
    // STEP 2: Get all subproject IDs and fetch their request types
    // ============================================
    const uniqueSubprojectIds = new Set();
    
    for (const resource of resources) {
      for (const subproject of resource.assigned_subprojects || []) {
        if (subproject_id && subproject._id.toString() !== subproject_id) continue;
        if (project_id && subproject.project_id && subproject.project_id.toString() !== project_id) continue;
        uniqueSubprojectIds.add(subproject._id.toString());
      }
    }

    const subprojectIdsArray = Array.from(uniqueSubprojectIds).map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        return id;
      }
    });

    // Fetch ALL request types for these subprojects
    const requestTypes = await SubprojectRequestType.find({
      subproject_id: { $in: subprojectIdsArray }
    }).lean();

    // Create request type map: subproject_id -> [{ name, rate, _id }]
    const requestTypeMap = new Map();
    requestTypes.forEach(rt => {
      const spId = rt.subproject_id.toString();
      if (!requestTypeMap.has(spId)) {
        requestTypeMap.set(spId, []);
      }
      requestTypeMap.get(spId).push({
        _id: rt._id,
        name: rt.name,
        rate: rt.rate || 0
      });
    });

    // ============================================
    // STEP 3: Build resource-subproject-requestType pairs
    // ============================================
    const resourceSubprojectPairs = [];
    
    for (const resource of resources) {
      for (const subproject of resource.assigned_subprojects || []) {
        if (subproject_id && subproject._id.toString() !== subproject_id) continue;
        if (project_id && subproject.project_id && subproject.project_id.toString() !== project_id) continue;

        const spIdStr = subproject._id.toString();
        const spRequestTypes = requestTypeMap.get(spIdStr) || [];

        // If no request types defined, create one entry with null request_type
        if (spRequestTypes.length === 0) {
          resourceSubprojectPairs.push({
            resource_id: resource._id,
            resource_name: resource.name,
            resource_email: resource.email,
            resource_role: resource.role,
            resource_avatar: resource.avatar_url,
            subproject_id: subproject._id,
            subproject_id_str: spIdStr,
            subproject_name: subproject.name,
            subproject_flatrate: subproject.flatrate || 0,
            project_id: subproject.project_id,
            request_type: null,
            request_type_rate: 0
          });
        } else {
          // Create one entry per request type (should be 3: New Request, Key, Duplicate)
          for (const rt of spRequestTypes) {
            // Apply request_type filter if provided
            if (request_type && rt.name !== request_type) continue;

            resourceSubprojectPairs.push({
              resource_id: resource._id,
              resource_name: resource.name,
              resource_email: resource.email,
              resource_role: resource.role,
              resource_avatar: resource.avatar_url,
              subproject_id: subproject._id,
              subproject_id_str: spIdStr,
              subproject_name: subproject.name,
              subproject_flatrate: subproject.flatrate || 0,
              project_id: subproject.project_id,
              request_type: rt.name,
              request_type_id: rt._id,
              request_type_rate: rt.rate || 0
            });
          }
        }
      }
    }

    // ============================================
    // STEP 4: Fetch productivity rates
    // ============================================
    const productivityRates = await Productivity.find({
      subproject_id: { $in: subprojectIdsArray }
    }).lean();

    const productivityMap = new Map();
    productivityRates.forEach(rate => {
      const spId = rate.subproject_id.toString();
      if (!productivityMap.has(spId)) {
        productivityMap.set(spId, []);
      }
      productivityMap.get(spId).push({
        level: rate.level.toLowerCase(),
        base_rate: rate.base_rate || 0
      });
    });

    // ============================================
    // STEP 5: Fetch billing records
    // ============================================
    const billingQuery = {
      year: parseInt(year) || new Date().getFullYear()
    };

    if (month === 'null' || month === null || month === undefined) {
      billingQuery.month = null;
    } else if (month) {
      billingQuery.month = parseInt(month);
    }

    if (subproject_id) {
      billingQuery.subproject_id = new mongoose.Types.ObjectId(subproject_id);
    } else if (project_id) {
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      billingQuery.subproject_id = { $in: subprojects.map(sp => sp._id) };
    }

    if (request_type) {
      billingQuery.request_type = request_type;
    }

    const resourceIds = [...new Set(resourceSubprojectPairs.map(p => p.resource_id.toString()))];
    if (resourceIds.length > 0) {
      billingQuery.resource_id = { $in: resourceIds.map(id => new mongoose.Types.ObjectId(id)) };
    }

    const billingRecords = await Billing.find(billingQuery)
      .populate('project_id', 'name')
      .lean();

    // Create billing map with request_type as part of the key
    const billingMap = new Map();
    billingRecords.forEach(billing => {
      const key = `${billing.resource_id.toString()}-${billing.subproject_id.toString()}-${billing.request_type || 'null'}`;
      billingMap.set(key, billing);
    });

    // ============================================
    // STEP 6: Fetch project info
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
    // STEP 7: Helper function to get rate for a level
    // ============================================
    const getRateForLevel = (rates, level) => {
      if (!rates || rates.length === 0) return 0;
      const normalizedLevel = (level || 'medium').toLowerCase();
      const found = rates.find(r => r.level === normalizedLevel);
      return found ? found.base_rate : 0;
    };

    // ============================================
    // STEP 8: Merge pairs with billing data
    // ============================================
    const mergedData = resourceSubprojectPairs.map((pair) => {
      const key = `${pair.resource_id.toString()}-${pair.subproject_id.toString()}-${pair.request_type || 'null'}`;
      const billing = billingMap.get(key);
      const projectInfo = projectMap.get(pair.project_id?.toString());
      
      // Get productivity rates for this subproject
      const rates = productivityMap.get(pair.subproject_id_str) || [];
      const mediumRate = getRateForLevel(rates, 'medium');
      
      // Get available request types for this subproject
      const availableRequestTypes = requestTypeMap.get(pair.subproject_id_str) || [];
      
      if (billing) {
        // Has billing record
        const storedLevel = (billing.productivity_level || 'medium').toLowerCase();
        const currentRate = getRateForLevel(rates, storedLevel) || billing.rate || 0;

        return {
          uniqueId: `${pair.project_id}-${pair.subproject_id}-${pair.resource_id}-${pair.request_type || 'none'}`,
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
          
          requestType: billing.request_type || pair.request_type,
          requestTypeRate: pair.request_type_rate,
          availableRequestTypes: availableRequestTypes,
          
          hours: billing.hours || 0,
          rate: currentRate,
          flatrate: pair.subproject_flatrate,
          productivity: billing.productivity_level || 'Medium',
          description: billing.description || '',
          isBillable: billing.billable_status === 'Billable',
          
          costing: (billing.hours || 0) * currentRate,
          totalBill: (billing.hours || 0) * pair.subproject_flatrate,
          
          availableRates: rates,
          hasProductivityRates: rates.length > 0,
          isEditable: true
        };
      } else {
        // No billing record
        return {
          uniqueId: `${pair.project_id}-${pair.subproject_id}-${pair.resource_id}-${pair.request_type || 'none'}`,
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
          
          requestType: pair.request_type,
          requestTypeRate: pair.request_type_rate,
          availableRequestTypes: availableRequestTypes,
          
          hours: 0,
          rate: mediumRate,
          flatrate: pair.subproject_flatrate,
          productivity: 'Medium',
          description: '',
          isBillable: true,
          
          costing: 0,
          totalBill: 0,
          
          availableRates: rates,
          hasProductivityRates: rates.length > 0,
          isEditable: true
        };
      }
    });

    // ============================================
    // STEP 9: Filter, Sort, Paginate
    // ============================================
    let filteredData = mergedData;
    if (show_non_billable === 'false') {
      filteredData = mergedData.filter(item => item.isBillable);
    }

    const sortDirection = sort_order === 'descending' ? -1 : 1;
    const sortFieldMap = {
      'resource': 'name',
      'resource_name': 'name',
      'projectName': 'projectName',
      'subProjectName': 'subProjectName',
      'requestType': 'requestType',
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
        return sortDirection * (aVal || '').localeCompare(bVal || '');
      }
      return sortDirection * ((aVal || 0) - (bVal || 0));
    });

    const total = filteredData.length;
    const paginatedData = filteredData.slice(skip, skip + limitNum);

    // Response without warnings
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

// ================= GET TOTALS =================
router.get('/totals', async (req, res) => {
  try {
    const { month, year, project_id, subproject_id, request_type, show_non_billable = 'true' } = req.query;

    const query = {
      year: parseInt(year) || new Date().getFullYear()
    };

    if (month === 'null' || month === null) {
      query.month = null;
    } else if (month) {
      query.month = parseInt(month);
    }
    
    if (project_id) {
      const subprojects = await Subproject.find({ project_id }).select('_id').lean();
      query.subproject_id = { $in: subprojects.map(sp => sp._id) };
    } else if (subproject_id) {
      query.subproject_id = subproject_id;
    }

    if (request_type) {
      query.request_type = request_type;
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
      request_type,
      productivity_level,
      flatrate,
      hours,
      rate,
      description,
      billable_status,
      month,
      year,
    } = req.body;

    const project = await Project.findById(project_id);
    const subproject = await Subproject.findById(subproject_id);
    if (!project) return res.status(404).json({ message: 'Project not found' });
    
    const resource = await Resource.findById(resource_id);
    if (!resource) return res.status(404).json({ message: 'Resource not found' });

    // Fetch rate from productivity table
    const productivityLevel = productivity_level || 'medium';
    const productivityRate = await Productivity.findOne({
      subproject_id: subproject_id,
      level: productivityLevel.toLowerCase()
    }).lean();
    
    const finalRate = productivityRate?.base_rate || rate || 0;

    const billingMonth = month || new Date().getMonth() + 1;
    const billingYear = year || new Date().getFullYear();

    // Use upsert to avoid duplicate key errors
    const filter = {
      project_id,
      subproject_id,
      resource_id,
      month: billingMonth,
      year: billingYear,
      request_type: request_type || null
    };

    const updateData = {
      $set: {
        project_name: project.name,
        subproject_name: subproject ? subproject.name : '',
        resource_name: resource.name,
        resource_role: resource.role,
        flatrate: flatrate || subproject?.flatrate || 0,
        productivity_level: productivity_level || 'Medium',
        hours: hours || 0,
        rate: finalRate,
        costing: (hours || 0) * finalRate,
        total_amount: (hours || 0) * (flatrate || subproject?.flatrate || 0),
        billable_status: billable_status || 'Billable',
        description: description || null,
      },
      $setOnInsert: {
        project_id,
        subproject_id,
        resource_id,
        month: billingMonth,
        year: billingYear,
        request_type: request_type || null
      }
    };

    const result = await Billing.findOneAndUpdate(filter, updateData, {
      upsert: true,
      new: true,
      runValidators: true
    });

    return res.status(200).json({ message: 'Saved successfully', billing: result });
  } catch (err) {
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

        const projectId = fields.projectId || fields.project_id;
        const resourceId = fields._id || fields.resource_id;
        const subprojectId = fields.subprojectId || fields.subproject_id;
        const requestType = fields.requestType || fields.request_type || null;
        const month = fields.month ? parseInt(fields.month) : new Date().getMonth() + 1;
        const year = fields.year ? parseInt(fields.year) : new Date().getFullYear();

        if (!projectId || !resourceId || !subprojectId) {
          throw new Error('Missing required IDs (project, resource, subproject)');
        }

        // Build the filter for finding/creating the billing record
        const filter = {
          project_id: new mongoose.Types.ObjectId(projectId),
          subproject_id: new mongoose.Types.ObjectId(subprojectId),
          resource_id: new mongoose.Types.ObjectId(resourceId),
          month: month,
          year: year,
          request_type: requestType
        };

        // Fetch related data
        const [project, resource, subproject] = await Promise.all([
          Project.findById(projectId).lean(),
          Resource.findById(resourceId).lean(),
          Subproject.findById(subprojectId).lean()
        ]);

        if (!project) throw new Error('Project not found');
        if (!resource) throw new Error('Resource not found');
        if (!subproject) throw new Error('Subproject not found');

        // Determine productivity level
        const productivityLevel = fields.productivity_level || fields.productivity || 'Medium';
        const normalizedLevel = productivityLevel.toLowerCase();

        // Fetch rate from productivity table
        const productivityRate = await Productivity.findOne({
          subproject_id: subprojectId,
          level: normalizedLevel
        }).lean();

        const rate = productivityRate?.base_rate || 0;
        const hours = fields.hours !== undefined ? Number(fields.hours) : 0;
        const flatrate = fields.flatrate !== undefined ? Number(fields.flatrate) : (subproject.flatrate || 0);

        // Build update data
        const updateData = {
          $set: {
            project_name: project.name,
            subproject_name: subproject.name,
            resource_name: resource.name,
            resource_role: resource.role,
            productivity_level: productivityLevel.charAt(0).toUpperCase() + normalizedLevel.slice(1),
            hours: hours,
            rate: rate,
            flatrate: flatrate,
            costing: hours * rate,
            total_amount: hours * flatrate,
            billable_status: fields.isBillable !== undefined 
              ? (fields.isBillable ? 'Billable' : 'Non-Billable')
              : (fields.billable_status || 'Billable'),
            description: fields.description || ''
          },
          $setOnInsert: {
            project_id: new mongoose.Types.ObjectId(projectId),
            subproject_id: new mongoose.Types.ObjectId(subprojectId),
            resource_id: new mongoose.Types.ObjectId(resourceId),
            month: month,
            year: year,
            request_type: requestType
          }
        };

        // Use findOneAndUpdate with upsert to avoid duplicate key errors
        const result = await Billing.findOneAndUpdate(
          filter,
          updateData,
          { 
            upsert: true, 
            new: true,
            runValidators: true
          }
        );

        results.push(result);

      } catch (error) {
        console.error("Single update failed:", error.message);
        errors.push({ 
          update: { 
            projectId: update.projectId, 
            subprojectId: update.subprojectId, 
            resourceId: update._id,
            requestType: update.requestType 
          }, 
          error: error.message 
        });
      }
    }

    res.json({
      success: true,
      updated: results.length,
      errors: errors.length > 0 ? errors : undefined,
      results
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

    if (!resource.assigned_subprojects?.length)
      return res.status(400).json({ message: 'No assigned subprojects for this resource' });

    const currentMonth = new Date().getUTCMonth() + 1;
    const currentYear = new Date().getUTCFullYear();
    const createdBillings = [];

    for (const subId of resource.assigned_subprojects || []) {
      const sub = await Subproject.findById(subId).lean();
      if (!sub) continue;

      const projectId = sub.project_id;
      const project = await Project.findById(projectId);
      if (!project) continue;

      // Get request types for this subproject
      const requestTypes = await SubprojectRequestType.find({ subproject_id: subId }).lean();

      // Get medium rate
      const productivityRate = await Productivity.findOne({
        subproject_id: subId,
        level: 'medium'
      }).lean();
      const mediumRate = productivityRate?.base_rate || 0;

      // Create billing for each request type (or one with null if none defined)
      const typesToCreate = requestTypes.length > 0 
        ? requestTypes.map(rt => rt.name)
        : [null];

      for (const reqType of typesToCreate) {
        const filter = {
          project_id: projectId,
          subproject_id: subId,
          resource_id,
          request_type: reqType,
          month: currentMonth,
          year: currentYear
        };

        const updateData = {
          $setOnInsert: {
            project_id: projectId,
            subproject_id: subId,
            resource_id,
            request_type: reqType,
            month: currentMonth,
            year: currentYear,
            resource_name: resource.name,
            resource_role: resource.role,
            project_name: project.name,
            subproject_name: sub.name,
            productivity_level: 'Medium',
            hours: 0,
            rate: mediumRate,
            flatrate: sub.flatrate || 0,
            total_amount: 0,
            costing: 0,
            billable_status: 'Billable',
            description: `Auto-generated billing for ${sub.name}${reqType ? ' - ' + reqType : ''}`
          }
        };

        const result = await Billing.findOneAndUpdate(filter, updateData, {
          upsert: true,
          new: true
        });

        createdBillings.push(result);
      }
    }

    res.json({ 
      message: `Generated ${createdBillings.length} billing records`,
      billings: createdBillings 
    });
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

    const { hours, flatrate, rate, productivity_level, request_type, ...rest } = req.body;

    Object.assign(billing, rest);

    if (request_type !== undefined) {
      billing.request_type = request_type;
    }

    if (productivity_level) {
      billing.productivity_level = productivity_level;
      const productivityRate = await Productivity.findOne({
        subproject_id: billing.subproject_id,
        level: productivity_level.toLowerCase()
      }).lean();
      if (productivityRate) {
        billing.rate = productivityRate.base_rate;
      }
    }

    if (typeof hours !== 'undefined') billing.hours = Number(hours) || 0;
    if (typeof flatrate !== 'undefined') billing.flatrate = Number(flatrate) || 0;

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
    const { month, year, project_id, request_type } = req.query;

    const filters = {};
    if (month) filters.month = parseInt(month);
    if (year) filters.year = parseInt(year);
    if (project_id) filters.project_id = project_id;
    if (request_type) filters.request_type = request_type;

    const billings = await Billing.find(filters);

    const totalBillable = billings.filter(b => b.billable_status === 'Billable')
      .reduce((acc, b) => acc + (b.total_amount || 0), 0);

    const totalNonBillable = billings.filter(b => b.billable_status === 'Non-Billable')
      .reduce((acc, b) => acc + (b.total_amount || 0), 0);

    const totalBillableHours = billings.filter(b => b.billable_status === 'Billable')
      .reduce((acc, b) => acc + (b.hours || 0), 0);

    const totalNonBillableHours = billings.filter(b => b.billable_status === 'Non-Billable')
      .reduce((acc, b) => acc + (b.hours || 0), 0);

    // Group by request type
    const byRequestType = {};
    billings.forEach(b => {
      const rt = b.request_type || 'Unspecified';
      if (!byRequestType[rt]) {
        byRequestType[rt] = { hours: 0, amount: 0, count: 0 };
      }
      byRequestType[rt].hours += b.hours || 0;
      byRequestType[rt].amount += b.total_amount || 0;
      byRequestType[rt].count += 1;
    });

    res.json({
      client_billable_total: totalBillable,
      internal_cost: totalNonBillable,
      grand_total: totalBillable + totalNonBillable,
      billable_hours: totalBillableHours,
      non_billable_hours: totalNonBillableHours,
      total_hours: totalBillableHours + totalNonBillableHours,
      record_count: billings.length,
      by_request_type: byRequestType
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
    if (subproject_id && productivity_level) {
      const prod = await Productivity.findOne({
        subproject_id,
        level: productivity_level.toLowerCase()
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