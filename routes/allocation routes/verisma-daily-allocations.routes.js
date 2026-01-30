// routes/verisma-daily-allocations.routes.js - Verisma Daily Allocation CRUD
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const VerismaDailyAllocation = require('../../models/Verismadailyallocation');
const SubprojectRequestType = require('../../models/SubprojectRequestType');
const { authenticateResource, authenticateUser } = require('../../middleware/auth');

// Helper: Check if date is locked
const isDateLocked = (date) => {
  const now = new Date();
  const pstOffset = -8 * 60;
  const pstNow = new Date(now.getTime() + (pstOffset - now.getTimezoneOffset()) * 60000);
  
  const allocDate = new Date(date);
  const lastDayOfMonth = new Date(allocDate.getFullYear(), allocDate.getMonth() + 1, 0).getDate();
  const lockDate = new Date(allocDate.getFullYear(), allocDate.getMonth(), lastDayOfMonth, 23, 59, 59);
  
  return pstNow > lockDate;
};

// Helper: Get next SR number
const getNextSrNo = async (resourceId, date) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const lastEntry = await VerismaDailyAllocation.findOne({
    resource_id: resourceId,
    allocation_date: { $gte: startOfDay, $lte: endOfDay }
  }).sort({ sr_no: -1 });
  
  return lastEntry ? lastEntry.sr_no + 1 : 1;
};

// Helper: Get billing rate from SubprojectRequestType
const getBillingRate = async (subprojectId, requestType) => {
  try {
    const rateRecord = await SubprojectRequestType.findOne({
      subproject_id: subprojectId,
      name: requestType
    });
    return rateRecord?.rate || 0;
  } catch (err) {
    return 0;
  }
};

// ==================== CREATE ALLOCATION (Resource) ====================
router.post('/', authenticateResource, async (req, res) => {
  try {
    const {
      subproject_id,
      request_type,
      count,
      remark,
      allocation_date,
      geography_id,
      geography_name
    } = req.body;

    if (!subproject_id || !request_type || !allocation_date) {
      return res.status(400).json({ message: 'Location, Request Type, and Date are required' });
    }

    if (isDateLocked(allocation_date)) {
      return res.status(403).json({ message: 'Cannot add entries for a locked month' });
    }

    // Verify resource has access to this Verisma location
    const resource = req.resource;
    let hasAccess = false;
    let locationInfo = null;

    for (const assignment of resource.assignments) {
      if (assignment.client_name?.toLowerCase() !== 'verisma') continue;
      
      for (const sp of assignment.subprojects) {
        if (sp.subproject_id.toString() === subproject_id) {
          hasAccess = true;
          locationInfo = {
            geography_id: geography_id || assignment.geography_id,
            geography_name: geography_name || assignment.geography_name,
            client_id: assignment.client_id,
            client_name: assignment.client_name,
            project_id: assignment.project_id,
            project_name: assignment.project_name,
            subproject_id: sp.subproject_id,
            subproject_name: sp.subproject_name
          };
          break;
        }
      }
      if (hasAccess) break;
    }

    if (!hasAccess) {
      return res.status(403).json({ message: 'You do not have access to this Verisma location' });
    }

    // Get billing rate from SubprojectRequestType
    const billingRate = await getBillingRate(subproject_id, request_type);
    const entryCount = parseInt(count) || 1;

    // Get next SR number
    const sr_no = await getNextSrNo(resource._id, allocation_date);

    const allocation = new VerismaDailyAllocation({
      sr_no,
      allocation_date: new Date(allocation_date),
      resource_id: resource._id,
      resource_name: resource.name,
      resource_email: resource.email,
      geography_id: locationInfo.geography_id,
      geography_name: locationInfo.geography_name,
      client_id: locationInfo.client_id,
      client_name: 'Verisma',
      project_id: locationInfo.project_id,
      project_name: locationInfo.project_name,
      subproject_id: locationInfo.subproject_id,
      subproject_name: locationInfo.subproject_name,
      request_type,
      count: entryCount,
      remark: remark || '',
      billing_rate: billingRate,
      billing_amount: billingRate * entryCount,
      is_locked: false
    });

    await allocation.save();

    res.status(201).json({
      message: 'Verisma allocation entry created successfully',
      allocation
    });

  } catch (error) {
    console.error('Error creating Verisma allocation:', error);
    res.status(500).json({ message: 'Error creating allocation', error: error.message });
  }
});

// ==================== GET MY ALLOCATIONS (Resource) ====================
router.get('/my-allocations', authenticateResource, async (req, res) => {
  try {
    const { date, start_date, end_date, page = 1, limit = 100 } = req.query;
    
    const filter = { resource_id: req.resource._id };

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.allocation_date = { $gte: startOfDay, $lte: endOfDay };
    } else if (start_date && end_date) {
      filter.allocation_date = {
        $gte: new Date(start_date),
        $lte: new Date(end_date)
      };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [allocations, total] = await Promise.all([
      VerismaDailyAllocation.find(filter)
        .sort({ allocation_date: -1, sr_no: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      VerismaDailyAllocation.countDocuments(filter)
    ]);

    res.json({
      allocations,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });

  } catch (error) {
    console.error('Error fetching Verisma allocations:', error);
    res.status(500).json({ message: 'Error fetching allocations', error: error.message });
  }
});

// ==================== UPDATE ALLOCATION (Resource) ====================
router.put('/:id', authenticateResource, async (req, res) => {
  try {
    const allocation = await VerismaDailyAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({ message: 'Allocation not found' });
    }

    if (allocation.resource_id.toString() !== req.resource._id.toString()) {
      return res.status(403).json({ message: 'You can only edit your own entries' });
    }

    if (allocation.is_locked || isDateLocked(allocation.allocation_date)) {
      return res.status(403).json({ message: 'This entry is locked and cannot be modified' });
    }

    // Allowed updates (not location/date/sr_no)
    const { request_type, count, remark } = req.body;
    
    if (request_type !== undefined) allocation.request_type = request_type;
    if (count !== undefined) allocation.count = parseInt(count) || 1;
    if (remark !== undefined) allocation.remark = remark;

    // Recalculate billing if request_type or count changed
    if (request_type !== undefined || count !== undefined) {
      const newRate = await getBillingRate(allocation.subproject_id, allocation.request_type);
      allocation.billing_rate = newRate;
      allocation.billing_amount = newRate * allocation.count;
    }

    await allocation.save();

    res.json({ message: 'Allocation updated successfully', allocation });

  } catch (error) {
    console.error('Error updating Verisma allocation:', error);
    res.status(500).json({ message: 'Error updating allocation', error: error.message });
  }
});

// ==================== DELETE ALLOCATION (Resource) ====================
router.delete('/:id', authenticateResource, async (req, res) => {
  try {
    const allocation = await VerismaDailyAllocation.findById(req.params.id);

    if (!allocation) {
      return res.status(404).json({ message: 'Allocation not found' });
    }

    if (allocation.resource_id.toString() !== req.resource._id.toString()) {
      return res.status(403).json({ message: 'You can only delete your own entries' });
    }

    if (allocation.is_locked || isDateLocked(allocation.allocation_date)) {
      return res.status(403).json({ message: 'This entry is locked and cannot be deleted' });
    }

    await allocation.deleteOne();

    res.json({ message: 'Allocation deleted successfully' });

  } catch (error) {
    console.error('Error deleting Verisma allocation:', error);
    res.status(500).json({ message: 'Error deleting allocation', error: error.message });
  }
});

// ==================== ADMIN: GET ALL ALLOCATIONS ====================
router.get('/admin/all', authenticateUser, async (req, res) => {
  try {
    const { date, start_date, end_date, resource_id, subproject_id, request_type, page = 1, limit = 100 } = req.query;
    
    const filter = {};

    if (date) {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);
      filter.allocation_date = { $gte: startOfDay, $lte: endOfDay };
    } else if (start_date && end_date) {
      filter.allocation_date = { $gte: new Date(start_date), $lte: new Date(end_date) };
    }

    if (resource_id) filter.resource_id = new mongoose.Types.ObjectId(resource_id);
    if (subproject_id) filter.subproject_id = new mongoose.Types.ObjectId(subproject_id);
    if (request_type) filter.request_type = request_type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [allocations, total] = await Promise.all([
      VerismaDailyAllocation.find(filter)
        .sort({ allocation_date: -1, resource_name: 1, sr_no: 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      VerismaDailyAllocation.countDocuments(filter)
    ]);

    res.json({
      allocations,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
    });

  } catch (error) {
    console.error('Error fetching all Verisma allocations:', error);
    res.status(500).json({ message: 'Error fetching allocations', error: error.message });
  }
});

module.exports = router;