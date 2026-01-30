

// routes/resource.js - Routes for resource management (admin use)
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Resource = require('../models/Resource');
const Geography = require('../models/Geography');
const Client = require('../models/Client');
const Project = require('../models/Project');
const Subproject = require('../models/Subproject');
const { authenticateUser, authenticateResource, authenticateAny } = require('../middleware/auth');

// ================= Get All Resources (Admin) =================
router.get('/', authenticateUser, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const total = await Resource.countDocuments(filter);
    const resources = await Resource.find(filter)
      .select('-password_hash -reset_token -reset_token_expiry')
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    res.json({
      resources,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching resources:', error);
    res.status(500).json({ message: 'Error fetching resources', error: error.message });
  }
});

// ================= Get Single Resource (Admin) =================
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id)
      .select('-password_hash -reset_token -reset_token_expiry');
    
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    res.json(resource);
  } catch (error) {
    console.error('Error fetching resource:', error);
    res.status(500).json({ message: 'Error fetching resource', error: error.message });
  }
});

// ================= Create Resource (Admin) =================
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { name, email, role, employee_id, status, assignments } = req.body;
    
    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }
    
    const existingResource = await Resource.findOne({ email: email.toLowerCase() });
    if (existingResource) {
      return res.status(409).json({ message: 'Email already exists' });
    }
    
    // No password needed - OTP based login
    const resource = new Resource({
      name,
      email: email.toLowerCase(),
      role: role || 'associate',
      employee_id,
      status: status || 'active',
      assignments: assignments || [],
      login_count: 0,
      total_logins: 0
    });
    
    await resource.save();
    
    res.status(201).json({
      message: 'Resource created successfully',
      resource: {
        id: resource._id,
        name: resource.name,
        email: resource.email
      }
    });
  } catch (error) {
    console.error('Error creating resource:', error);
    res.status(500).json({ message: 'Error creating resource', error: error.message });
  }
});

// ================= Update Resource (Admin) =================
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const { name, email, role, employee_id, status, assignments } = req.body;
    
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    // Check email uniqueness if changed
    if (email && email.toLowerCase() !== resource.email) {
      const existingResource = await Resource.findOne({ email: email.toLowerCase() });
      if (existingResource) {
        return res.status(409).json({ message: 'Email already exists' });
      }
      resource.email = email.toLowerCase();
    }
    
    if (name) resource.name = name;
    if (role) resource.role = role;
    if (employee_id !== undefined) resource.employee_id = employee_id;
    if (status) resource.status = status;
    if (assignments) resource.assignments = assignments;
    
    await resource.save();
    
    const updatedResource = resource.toObject();
    delete updatedResource.otp;
    delete updatedResource.otp_expires;
    
    res.json({
      message: 'Resource updated successfully',
      resource: updatedResource
    });
  } catch (error) {
    console.error('Error updating resource:', error);
    res.status(500).json({ message: 'Error updating resource', error: error.message });
  }
});

// ================= Delete Resource (Admin) =================
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const resource = await Resource.findByIdAndDelete(req.params.id);
    
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    res.json({ message: 'Resource deleted successfully' });
  } catch (error) {
    console.error('Error deleting resource:', error);
    res.status(500).json({ message: 'Error deleting resource', error: error.message });
  }
});

// ================= Update Resource Assignments (Admin) =================
router.put('/:id/assignments', authenticateUser, async (req, res) => {
  try {
    const { assignments } = req.body;
    
    const resource = await Resource.findById(req.params.id);
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    // Validate and enrich assignments with names
    const enrichedAssignments = [];
    
    for (const assignment of assignments) {
      const geography = await Geography.findById(assignment.geography_id);
      const client = await Client.findById(assignment.client_id);
      const project = await Project.findById(assignment.project_id);
      
      if (!geography || !client || !project) {
        return res.status(400).json({ 
          message: 'Invalid geography, client, or project ID in assignment' 
        });
      }
      
      const subprojects = [];
      for (const sp of assignment.subprojects || []) {
        const subproject = await Subproject.findById(sp.subproject_id);
        if (subproject) {
          subprojects.push({
            subproject_id: subproject._id,
            subproject_name: subproject.name
          });
        }
      }
      
      enrichedAssignments.push({
        geography_id: geography._id,
        geography_name: geography.name,
        client_id: client._id,
        client_name: client.name,
        project_id: project._id,
        project_name: project.name,
        subprojects
      });
    }
    
    resource.assignments = enrichedAssignments;
    await resource.save();
    
    res.json({
      message: 'Assignments updated successfully',
      assignments: resource.assignments
    });
  } catch (error) {
    console.error('Error updating assignments:', error);
    res.status(500).json({ message: 'Error updating assignments', error: error.message });
  }
});

// ================= Bulk Create Resources from CSV (Admin) =================
router.post('/bulk-create', authenticateUser, async (req, res) => {
  try {
    const { resources } = req.body;
    
    if (!Array.isArray(resources) || resources.length === 0) {
      return res.status(400).json({ message: 'Resources array is required' });
    }
    
    const results = {
      created: [],
      failed: [],
      skipped: []
    };
    
    for (const resourceData of resources) {
      try {
        // Check if email already exists
        const existingResource = await Resource.findOne({ 
          email: resourceData.email.toLowerCase() 
        });
        
        if (existingResource) {
          // Update assignments if resource exists
          const newAssignments = resourceData.assignments || [];
          
          // Merge assignments (avoid duplicates)
          for (const newAssignment of newAssignments) {
            const existingAssignment = existingResource.assignments.find(
              a => a.client_id.toString() === newAssignment.client_id.toString() &&
                   a.project_id.toString() === newAssignment.project_id.toString()
            );
            
            if (existingAssignment) {
              // Merge subprojects
              for (const newSp of newAssignment.subprojects || []) {
                const spExists = existingAssignment.subprojects.some(
                  sp => sp.subproject_id.toString() === newSp.subproject_id.toString()
                );
                if (!spExists) {
                  existingAssignment.subprojects.push(newSp);
                }
              }
            } else {
              existingResource.assignments.push(newAssignment);
            }
          }
          
          await existingResource.save();
          results.skipped.push({
            email: resourceData.email,
            message: 'Updated existing resource assignments'
          });
          continue;
        }
        
        // Create new resource (no password needed - OTP based)
        const resource = new Resource({
          name: resourceData.name,
          email: resourceData.email.toLowerCase(),
          role: resourceData.role || 'associate',
          employee_id: resourceData.employee_id,
          status: 'active',
          assignments: resourceData.assignments || [],
          login_count: 0,
          total_logins: 0
        });
        
        await resource.save();
        results.created.push({
          id: resource._id,
          email: resource.email,
          name: resource.name
        });
        
      } catch (err) {
        results.failed.push({
          email: resourceData.email,
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

// ================= Get Resource's Own Profile =================
router.get('/me/profile', authenticateResource, async (req, res) => {
  try {
    const resource = await Resource.findById(req.resource._id)
      .select('-password_hash -reset_token -reset_token_expiry');
    
    res.json(resource);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Error fetching profile', error: error.message });
  }
});

// ================= Get All Resources Login Activity (Admin) =================
router.get('/login-activity', authenticateUser, async (req, res) => {
  try {
    const { sort_by = 'last_login', sort_order = 'desc' } = req.query;
    
    const sortOptions = {};
    sortOptions[sort_by] = sort_order === 'asc' ? 1 : -1;
    
    const resources = await Resource.find({})
      .select('name email role status total_logins login_count last_login login_history monthly_logins')
      .sort(sortOptions);
    
    res.json({ resources });
  } catch (error) {
    console.error('Error fetching login activity:', error);
    res.status(500).json({ message: 'Error fetching login activity', error: error.message });
  }
});

// ================= Get Single Resource Login Activity (Admin) =================
router.get('/login-activity/:id', authenticateUser, async (req, res) => {
  try {
    const resource = await Resource.findById(req.params.id)
      .select('name email role status total_logins login_count last_login login_history monthly_logins');
    
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }
    
    res.json(resource);
  } catch (error) {
    console.error('Error fetching resource activity:', error);
    res.status(500).json({ message: 'Error fetching resource activity', error: error.message });
  }
});

// ================= Get Resource's Accessible Locations =================
router.get('/me/locations', authenticateResource, async (req, res) => {
  try {
    // Return the resource's assignments (accessible locations)
    const assignments = req.resource.assignments;
    
    // Optionally expand with full details
    const expandedAssignments = [];
    
    for (const assignment of assignments) {
      const subprojectDetails = [];
      
      for (const sp of assignment.subprojects) {
        const subproject = await Subproject.findById(sp.subproject_id);
        if (subproject) {
          subprojectDetails.push({
            subproject_id: subproject._id,
            subproject_name: subproject.name,
            status: subproject.status
          });
        }
      }
      
      expandedAssignments.push({
        geography_id: assignment.geography_id,
        geography_name: assignment.geography_name,
        client_id: assignment.client_id,
        client_name: assignment.client_name,
        project_id: assignment.project_id,
        project_name: assignment.project_name,
        subprojects: subprojectDetails
      });
    }
    
    res.json(expandedAssignments);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ message: 'Error fetching locations', error: error.message });
  }
});

module.exports = router;
