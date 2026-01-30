// routes/dailyAllocation.js - Routes for resources to log daily work
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DailyAllocation = require('../models/DailyAllocation');
const Resource = require('../models/Resource');
const Subproject = require('../models/Subproject');
const { authenticateResource, authenticateUser, authenticateAny } = require('../middleware/auth');

// Dropdown options
const DROPDOWN_OPTIONS = {
  request_type: ['Batch', 'DDS', 'E-link', 'E-Request', 'Follow up', 'New Request'],
  requestor_type: ['NRS-NO Records', 'Other Processing (Canceled/Released By Other)', 'Processed', 'Processed through File Drop'],
  process_type: ['Logging', 'MRO Payer Project', 'Processing']
};

// ================= Get Dropdown Options =================
router.get('/options', (req, res) => {
  res.json(DROPDOWN_OPTIONS);
});

// ================= Create Daily Allocation (Resource) =================
router.post('/', authenticateResource, async (req, res) => {
  try {
    const {
      allocation_date,
      subproject_id,
      facility_name,
      request_id,
      request_type,
      requestor_type,
      process_type,
      remark
    } = req.body;

    if (!allocation_date || !subproject_id || !request_type || !process_type) {
      return res.status(400).json({ 
        message: 'Allocation date, location, request type, and process type are required' 
      });
    }

    // Check if resource has access to this subproject
    if (!req.resource.hasAccessToSubproject(subproject_id)) {
      return res.status(403).json({ message: 'You do not have access to this location' });
    }

    // Check if date is locked
    const isLocked = DailyAllocation.isDateLocked(allocation_date);
    if (isLocked) {
      return res.status(403).json({ 
        message: 'Entries for this month are locked. Cannot add new entries after month end.' 
      });
    }

    // Get subproject details
    const subproject = await Subproject.findById(subproject_id);
    if (!subproject) {
      return res.status(404).json({ message: 'Location not found' });
    }

    // Get next SR number for this resource and date
    const date = new Date(allocation_date);
    const startOfDay = new Date(date.setHours(0, 0, 0, 0));
    const endOfDay = new Date(date.setHours(23, 59, 59, 999));
    
    const lastEntry = await DailyAllocation.findOne({
      resource_id: req.resource._id,
      allocation_date: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ sr_no: -1 });
    
    const sr_no = (lastEntry?.sr_no || 0) + 1;

    const allocation = new DailyAllocation({
      sr_no,
      allocation_date: new Date(allocation_date),
      resource_id: req.resource._id,
      resource_name: req.resource.name,
      resource_email: req.resource.email,
      geography_id: subproject.geography_id,
      geography_name: subproject.geography_name,
      client_id: subproject.client_id,
      client_name: subproject.client_name,
      project_id: subproject.project_id,
      project_name: subproject.project_name,
      subproject_id: subproject._id,
      subproject_name: subproject.name,
      facility_name,
      request_id,
      request_type,
      requestor_type,
      process_type,
      remark,
      status: 'submitted'
    });

    await allocation.save();

    res.status(201).json({
      message: 'Allocation entry created successfully',
      allocation
    });
  } catch (error) {
    console.error('Error creating allocation:', error);
    res.status(500).json({ message: 'Error creating allocation', error: error.message });
  }
});

// ================= Bulk Create Allocations (Resource) =================
router.post('/bulk', authenticateResource, async (req, res) => {
  try {
    const { allocations } = req.body;

    if (!Array.isArray(allocations) || allocations.length === 0) {
      return res.status(400).json({ message: 'Allocations array is required' });
    }

    const results = {
      created: [],
      failed: []
    };

    // Get accessible subproject IDs
    const accessibleSubprojectIds = req.resource.getAccessibleSubprojectIds()
      .map(id => id.toString());

    for (const allocationData of allocations) {
      try {
        // Validate access
        if (!accessibleSubprojectIds.includes(allocationData.subproject_id.toString())) {
          results.failed.push({
            data: allocationData,
            error: 'Access denied to this location'
          });
          continue;
        }

        // Check if date is locked
        if (DailyAllocation.isDateLocked(allocationData.allocation_date)) {
          results.failed.push({
            data: allocationData,
            error: 'Date is locked'
          });
          continue;
        }

        // Get subproject details
        const subproject = await Subproject.findById(allocationData.subproject_id);
        if (!subproject) {
          results.failed.push({
            data: allocationData,
            error: 'Location not found'
          });
          continue;
        }

        // Calculate SR number
        const date = new Date(allocationData.allocation_date);
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const lastEntry = await DailyAllocation.findOne({
          resource_id: req.resource._id,
          allocation_date: { $gte: startOfDay, $lte: endOfDay }
        }).sort({ sr_no: -1 });
        
        const sr_no = (lastEntry?.sr_no || 0) + 1;

        const allocation = new DailyAllocation({
          sr_no,
          allocation_date: new Date(allocationData.allocation_date),
          resource_id: req.resource._id,
          resource_name: req.resource.name,
          resource_email: req.resource.email,
          geography_id: subproject.geography_id,
          geography_name: subproject.geography_name,
          client_id: subproject.client_id,
          client_name: subproject.client_name,
          project_id: subproject.project_id,
          project_name: subproject.project_name,
          subproject_id: subproject._id,
          subproject_name: subproject.name,
          facility_name: allocationData.facility_name,
          request_id: allocationData.request_id,
          request_type: allocationData.request_type,
          requestor_type: allocationData.requestor_type,
          process_type: allocationData.process_type,
          remark: allocationData.remark,
          status: 'submitted'
        });

        await allocation.save();
        results.created.push(allocation);

      } catch (err) {
        results.failed.push({
          data: allocationData,
          error: err.message
        });
      }
    }

    res.json({
      message: 'Bulk operation completed',
      results
    });
  } catch (error) {
    console.error('Error in bulk create:', error);
    res.status(500).json({ message: 'Error in bulk create', error: error.message });
  }
});

// ================= Get Resource's Allocations =================
router.get('/my-allocations', authenticateResource, async (req, res) => {
  try {
    const { 
      date, 
      start_date, 
      end_date, 
      subproject_id,
      status,
      page = 1, 
      limit = 100 
    } = req.query;

    const filter = { resource_id: req.resource._id };

    // Date filters
    if (date) {
      const queryDate = new Date(date);
      const startOfDay = new Date(queryDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(queryDate);
      endOfDay.setHours(23, 59, 59, 999);
      filter.allocation_date = { $gte: startOfDay, $lte: endOfDay };
    } else if (start_date && end_date) {
      filter.allocation_date = {
        $gte: new Date(start_date),
        $lte: new Date(end_date)
      };
    }

    if (subproject_id) {
      filter.subproject_id = new mongoose.Types.ObjectId(subproject_id);
    }

    if (status) {
      filter.status = status;
    }

    const total = await DailyAllocation.countDocuments(filter);
    const allocations = await DailyAllocation.find(filter)
      .sort({ allocation_date: -1, sr_no: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      allocations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching allocations:', error);
    res.status(500).json({ message: 'Error fetching allocations', error: error.message });
  }
});

// ================= Update Allocation (Resource) =================
router.put('/:id', authenticateResource, async (req, res) => {
  try {
    const allocation = await DailyAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({ message: 'Allocation not found' });
    }

    // Check ownership
    if (allocation.resource_id.toString() !== req.resource._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if locked
    if (allocation.is_locked) {
      return res.status(403).json({ message: 'This entry is locked and cannot be modified' });
    }

    // Check if date is past lock period
    if (DailyAllocation.isDateLocked(allocation.allocation_date)) {
      return res.status(403).json({ message: 'Entries for this month are locked' });
    }

    const {
      facility_name,
      request_id,
      request_type,
      requestor_type,
      process_type,
      remark
    } = req.body;

    if (facility_name !== undefined) allocation.facility_name = facility_name;
    if (request_id !== undefined) allocation.request_id = request_id;
    if (request_type) allocation.request_type = request_type;
    if (requestor_type !== undefined) allocation.requestor_type = requestor_type;
    if (process_type) allocation.process_type = process_type;
    if (remark !== undefined) allocation.remark = remark;

    await allocation.save();

    res.json({
      message: 'Allocation updated successfully',
      allocation
    });
  } catch (error) {
    console.error('Error updating allocation:', error);
    res.status(500).json({ message: 'Error updating allocation', error: error.message });
  }
});

// ================= Delete Allocation (Resource) =================
router.delete('/:id', authenticateResource, async (req, res) => {
  try {
    const allocation = await DailyAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({ message: 'Allocation not found' });
    }

    // Check ownership
    if (allocation.resource_id.toString() !== req.resource._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if locked
    if (allocation.is_locked) {
      return res.status(403).json({ message: 'This entry is locked and cannot be deleted' });
    }

    // Check if date is past lock period
    if (DailyAllocation.isDateLocked(allocation.allocation_date)) {
      return res.status(403).json({ message: 'Entries for this month are locked' });
    }

    await DailyAllocation.findByIdAndDelete(req.params.id);

    res.json({ message: 'Allocation deleted successfully' });
  } catch (error) {
    console.error('Error deleting allocation:', error);
    res.status(500).json({ message: 'Error deleting allocation', error: error.message });
  }
});

// ================= Admin Routes =================

// Get all allocations (Admin)
router.get('/admin/all', authenticateUser, async (req, res) => {
  try {
    const {
      resource_id,
      client_id,
      project_id,
      subproject_id,
      start_date,
      end_date,
      month,
      year,
      status,
      page = 1,
      limit = 100
    } = req.query;

    const filter = {};

    if (resource_id) filter.resource_id = new mongoose.Types.ObjectId(resource_id);
    if (client_id) filter.client_id = new mongoose.Types.ObjectId(client_id);
    if (project_id) filter.project_id = new mongoose.Types.ObjectId(project_id);
    if (subproject_id) filter.subproject_id = new mongoose.Types.ObjectId(subproject_id);
    if (status) filter.status = status;

    if (start_date && end_date) {
      filter.allocation_date = {
        $gte: new Date(start_date),
        $lte: new Date(end_date)
      };
    } else if (month && year) {
      filter.month = parseInt(month);
      filter.year = parseInt(year);
    }

    const total = await DailyAllocation.countDocuments(filter);
    const allocations = await DailyAllocation.find(filter)
      .sort({ allocation_date: -1, resource_name: 1, sr_no: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    res.json({
      allocations,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching all allocations:', error);
    res.status(500).json({ message: 'Error fetching allocations', error: error.message });
  }
});

// Get summary/stats (Admin)
router.get('/admin/summary', authenticateUser, async (req, res) => {
  try {
    const { month, year, client_id, project_id } = req.query;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const matchFilter = {
      month: parseInt(month),
      year: parseInt(year)
    };

    if (client_id) matchFilter.client_id = new mongoose.Types.ObjectId(client_id);
    if (project_id) matchFilter.project_id = new mongoose.Types.ObjectId(project_id);

    const summary = await DailyAllocation.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: {
            client_id: '$client_id',
            client_name: '$client_name',
            project_name: '$project_name',
            subproject_name: '$subproject_name',
            request_type: '$request_type',
            process_type: '$process_type'
          },
          total_count: { $sum: 1 },
          resources: { $addToSet: '$resource_name' }
        }
      },
      {
        $group: {
          _id: {
            client_id: '$_id.client_id',
            client_name: '$_id.client_name'
          },
          locations: {
            $push: {
              project_name: '$_id.project_name',
              subproject_name: '$_id.subproject_name',
              request_type: '$_id.request_type',
              process_type: '$_id.process_type',
              count: '$total_count',
              resources: '$resources'
            }
          },
          total: { $sum: '$total_count' }
        }
      },
      { $sort: { '_id.client_name': 1 } }
    ]);

    res.json(summary);
  } catch (error) {
    console.error('Error fetching summary:', error);
    res.status(500).json({ message: 'Error fetching summary', error: error.message });
  }
});

// Lock entries for a month (Admin)
router.post('/admin/lock', authenticateUser, async (req, res) => {
  try {
    const { month, year, reason } = req.body;

    if (!month || !year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    const result = await DailyAllocation.updateMany(
      { month: parseInt(month), year: parseInt(year) },
      {
        is_locked: true,
        locked_at: new Date(),
        locked_reason: reason || 'Month end lock'
      }
    );

    res.json({
      message: `Locked ${result.modifiedCount} entries for ${month}/${year}`,
      modified: result.modifiedCount
    });
  } catch (error) {
    console.error('Error locking entries:', error);
    res.status(500).json({ message: 'Error locking entries', error: error.message });
  }
});

module.exports = router;
