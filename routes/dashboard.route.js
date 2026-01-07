// routes/dashboard.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Billing = require('../models/Billing');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');
const SubprojectRequestType = require('../models/SubprojectRequestType');

// ================= GET DASHBOARD SUMMARY =================
router.get('/billing-summary', async (req, res) => {
  try {
    const {
      project_id,
      subproject_id,
      month,
      year,
      search
    } = req.query;

    // Build match query
    const matchQuery = {
      year: parseInt(year) || new Date().getFullYear()
    };

    if (month && month !== 'all') {
      matchQuery.month = parseInt(month);
    }

    if (project_id) {
      matchQuery.project_id = new mongoose.Types.ObjectId(project_id);
    }

    if (subproject_id) {
      matchQuery.subproject_id = new mongoose.Types.ObjectId(subproject_id);
    }

    // Aggregation pipeline
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: {
            project_id: '$project_id',
            subproject_id: '$subproject_id',
            request_type: '$request_type'
          },
          totalHours: { $sum: '$hours' },
          totalCosting: { $sum: '$costing' },
          totalBilling: { $sum: '$total_amount' },
          resourceCount: { $addToSet: '$resource_id' },
          avgRate: { $avg: '$rate' },
          avgFlatrate: { $avg: '$flatrate' }
        }
      },
      {
        $group: {
          _id: {
            project_id: '$_id.project_id',
            subproject_id: '$_id.subproject_id'
          },
          requestTypes: {
            $push: {
              type: '$_id.request_type',
              hours: '$totalHours',
              costing: '$totalCosting',
              billing: '$totalBilling',
              resourceCount: { $size: '$resourceCount' },
              avgRate: '$avgRate',
              avgFlatrate: '$avgFlatrate'
            }
          },
          totalHours: { $sum: '$totalHours' },
          totalCosting: { $sum: '$totalCosting' },
          totalBilling: { $sum: '$totalBilling' }
        }
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id.project_id',
          foreignField: '_id',
          as: 'project'
        }
      },
      {
        $lookup: {
          from: 'subprojects',
          localField: '_id.subproject_id',
          foreignField: '_id',
          as: 'subproject'
        }
      },
      {
        $unwind: { path: '$project', preserveNullAndEmptyArrays: true }
      },
      {
        $unwind: { path: '$subproject', preserveNullAndEmptyArrays: true }
      },
      {
        $project: {
          _id: 0,
          projectId: '$_id.project_id',
          subprojectId: '$_id.subproject_id',
          projectName: { $ifNull: ['$project.name', 'Unknown'] },
          subprojectName: { $ifNull: ['$subproject.name', 'Unknown'] },
          flatrate: { $ifNull: ['$subproject.flatrate', 0] },
          requestTypes: 1,
          totalHours: 1,
          totalCosting: 1,
          totalBilling: 1
        }
      },
      {
        $sort: { subprojectName: 1 }
      }
    ];

    const results = await Billing.aggregate(pipeline);

    // Transform results to match the dashboard format
    const dashboardData = results.map(row => {
      // Initialize request type data
      const requestTypeData = {
        'New Request': { hours: 0, total: 0 },
        'Key': { hours: 0, total: 0 },
        'Duplicate': { hours: 0, total: 0 }
      };

      // Populate from aggregation results
      row.requestTypes.forEach(rt => {
        const typeName = rt.type || 'Unspecified';
        if (requestTypeData[typeName]) {
          requestTypeData[typeName].hours = rt.hours || 0;
          requestTypeData[typeName].total = rt.billing || 0;
        }
      });

      return {
        projectId: row.projectId,
        subprojectId: row.subprojectId,
        location: row.subprojectName,
        processType: row.projectName,
        flatrate: row.flatrate,
        
        // Request type breakdown
        duplicateHours: requestTypeData['Duplicate'].hours,
        duplicateTotal: requestTypeData['Duplicate'].total,
        
        keyHours: requestTypeData['Key'].hours,
        keyTotal: requestTypeData['Key'].total,
        
        newRequestHours: requestTypeData['New Request'].hours,
        newRequestTotal: requestTypeData['New Request'].total,
        
        // Totals
        totalCasesHours: row.totalHours,
        totalBilling: row.totalBilling,
        totalCosting: row.totalCosting
      };
    });

    // Apply search filter if provided
    let filteredData = dashboardData;
    if (search && search.trim()) {
      const searchLower = search.toLowerCase();
      filteredData = dashboardData.filter(row => 
        row.location.toLowerCase().includes(searchLower) ||
        row.processType.toLowerCase().includes(searchLower)
      );
    }

    // Calculate grand totals
    const grandTotals = filteredData.reduce((acc, row) => {
      acc.duplicateHours += row.duplicateHours;
      acc.duplicateTotal += row.duplicateTotal;
      acc.keyHours += row.keyHours;
      acc.keyTotal += row.keyTotal;
      acc.newRequestHours += row.newRequestHours;
      acc.newRequestTotal += row.newRequestTotal;
      acc.totalCasesHours += row.totalCasesHours;
      acc.totalBilling += row.totalBilling;
      return acc;
    }, {
      duplicateHours: 0,
      duplicateTotal: 0,
      keyHours: 0,
      keyTotal: 0,
      newRequestHours: 0,
      newRequestTotal: 0,
      totalCasesHours: 0,
      totalBilling: 0
    });

    res.json({
      data: filteredData,
      totals: grandTotals,
      count: filteredData.length
    });

  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET DASHBOARD SUMMARY BY PROJECT =================
router.get('/project-summary', async (req, res) => {
  try {
    const { month, year } = req.query;

    const matchQuery = {
      year: parseInt(year) || new Date().getFullYear()
    };

    if (month && month !== 'all') {
      matchQuery.month = parseInt(month);
    }

    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: '$project_id',
          totalHours: { $sum: '$hours' },
          totalBilling: { $sum: '$total_amount' },
          totalCosting: { $sum: '$costing' },
          subprojectCount: { $addToSet: '$subproject_id' },
          resourceCount: { $addToSet: '$resource_id' }
        }
      },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: '_id',
          as: 'project'
        }
      },
      { $unwind: '$project' },
      {
        $project: {
          projectId: '$_id',
          projectName: '$project.name',
          totalHours: 1,
          totalBilling: 1,
          totalCosting: 1,
          profit: { $subtract: ['$totalBilling', '$totalCosting'] },
          subprojectCount: { $size: '$subprojectCount' },
          resourceCount: { $size: '$resourceCount' }
        }
      },
      { $sort: { projectName: 1 } }
    ];

    const results = await Billing.aggregate(pipeline);

    res.json({
      data: results,
      count: results.length
    });

  } catch (err) {
    console.error('Project summary error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= GET REQUEST TYPE RATES =================
router.get('/request-type-rates', async (req, res) => {
  try {
    const { subproject_id } = req.query;

    const query = subproject_id ? { subproject_id } : {};
    
    const rates = await SubprojectRequestType.find(query)
      .populate('subproject_id', 'name')
      .lean();

    res.json(rates);

  } catch (err) {
    console.error('Request type rates error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;