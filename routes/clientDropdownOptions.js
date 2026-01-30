// routes/clientDropdownOptions.js - Manage client-specific dropdown options
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ClientDropdownOptions = require('../models/ClientDropdownOptions');
const Client = require('../models/Client');
const { authenticateUser, authenticateResource, authenticateAny } = require('../middleware/auth');

// ================= Get Options for a Client (Any authenticated user) =================
router.get('/client/:clientId', authenticateAny, async (req, res) => {
  try {
    const { clientId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ message: 'Invalid client ID' });
    }
    
    const options = await ClientDropdownOptions.getOptionsForClient(clientId);
    
    // Filter to only active options
    const activeOptions = {
      client_id: options.client_id,
      client_name: options.client_name,
      request_types: (options.request_types || []).filter(o => o.is_active).sort((a, b) => a.sort_order - b.sort_order),
      requestor_types: (options.requestor_types || []).filter(o => o.is_active).sort((a, b) => a.sort_order - b.sort_order),
      process_types: (options.process_types || []).filter(o => o.is_active).sort((a, b) => a.sort_order - b.sort_order),
      custom_fields: (options.custom_fields || []).filter(f => f.is_active)
    };
    
    res.json(activeOptions);
  } catch (error) {
    console.error('Error fetching dropdown options:', error);
    res.status(500).json({ message: 'Error fetching dropdown options', error: error.message });
  }
});

// ================= Get All Client Options (Admin) =================
router.get('/all', authenticateUser, async (req, res) => {
  try {
    const allOptions = await ClientDropdownOptions.find({})
      .populate('client_id', 'name')
      .sort({ client_name: 1 });
    
    res.json(allOptions);
  } catch (error) {
    console.error('Error fetching all options:', error);
    res.status(500).json({ message: 'Error fetching options', error: error.message });
  }
});

// ================= Create/Update Options for a Client (Admin) =================
router.post('/client/:clientId', authenticateUser, async (req, res) => {
  try {
    const { clientId } = req.params;
    const { request_types, requestor_types, process_types, custom_fields } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ message: 'Invalid client ID' });
    }
    
    // Get client name
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }
    
    // Find existing or create new
    let options = await ClientDropdownOptions.findOne({ client_id: clientId });
    
    if (options) {
      // Update existing
      if (request_types) options.request_types = request_types;
      if (requestor_types) options.requestor_types = requestor_types;
      if (process_types) options.process_types = process_types;
      if (custom_fields) options.custom_fields = custom_fields;
      options.client_name = client.name;
    } else {
      // Create new
      options = new ClientDropdownOptions({
        client_id: clientId,
        client_name: client.name,
        request_types: request_types || [],
        requestor_types: requestor_types || [],
        process_types: process_types || [],
        custom_fields: custom_fields || []
      });
    }
    
    await options.save();
    
    res.json({
      message: 'Options saved successfully',
      options
    });
  } catch (error) {
    console.error('Error saving options:', error);
    res.status(500).json({ message: 'Error saving options', error: error.message });
  }
});

// ================= Add Single Option to a Category (Admin) =================
router.post('/client/:clientId/:category', authenticateUser, async (req, res) => {
  try {
    const { clientId, category } = req.params;
    const { value, label, sort_order } = req.body;
    
    const validCategories = ['request_types', 'requestor_types', 'process_types'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    
    if (!value) {
      return res.status(400).json({ message: 'Value is required' });
    }
    
    // Get client
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: 'Client not found' });
    }
    
    let options = await ClientDropdownOptions.findOne({ client_id: clientId });
    
    if (!options) {
      options = new ClientDropdownOptions({
        client_id: clientId,
        client_name: client.name,
        request_types: [],
        requestor_types: [],
        process_types: []
      });
    }
    
    // Check if value already exists
    const exists = options[category].some(o => o.value.toLowerCase() === value.toLowerCase());
    if (exists) {
      return res.status(409).json({ message: 'Option already exists' });
    }
    
    // Add new option
    const maxOrder = options[category].length > 0 
      ? Math.max(...options[category].map(o => o.sort_order || 0)) 
      : -1;
    
    options[category].push({
      value,
      label: label || value,
      is_active: true,
      sort_order: sort_order !== undefined ? sort_order : maxOrder + 1
    });
    
    await options.save();
    
    res.json({
      message: 'Option added successfully',
      options: options[category]
    });
  } catch (error) {
    console.error('Error adding option:', error);
    res.status(500).json({ message: 'Error adding option', error: error.message });
  }
});

// ================= Update Single Option (Admin) =================
router.put('/client/:clientId/:category/:optionValue', authenticateUser, async (req, res) => {
  try {
    const { clientId, category, optionValue } = req.params;
    const { value, label, is_active, sort_order } = req.body;
    
    const validCategories = ['request_types', 'requestor_types', 'process_types'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    
    const options = await ClientDropdownOptions.findOne({ client_id: clientId });
    if (!options) {
      return res.status(404).json({ message: 'Client options not found' });
    }
    
    const optionIndex = options[category].findIndex(
      o => o.value.toLowerCase() === decodeURIComponent(optionValue).toLowerCase()
    );
    
    if (optionIndex === -1) {
      return res.status(404).json({ message: 'Option not found' });
    }
    
    // Update fields
    if (value !== undefined) options[category][optionIndex].value = value;
    if (label !== undefined) options[category][optionIndex].label = label;
    if (is_active !== undefined) options[category][optionIndex].is_active = is_active;
    if (sort_order !== undefined) options[category][optionIndex].sort_order = sort_order;
    
    await options.save();
    
    res.json({
      message: 'Option updated successfully',
      option: options[category][optionIndex]
    });
  } catch (error) {
    console.error('Error updating option:', error);
    res.status(500).json({ message: 'Error updating option', error: error.message });
  }
});

// ================= Delete Option (Admin) =================
router.delete('/client/:clientId/:category/:optionValue', authenticateUser, async (req, res) => {
  try {
    const { clientId, category, optionValue } = req.params;
    
    const validCategories = ['request_types', 'requestor_types', 'process_types'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ message: 'Invalid category' });
    }
    
    const options = await ClientDropdownOptions.findOne({ client_id: clientId });
    if (!options) {
      return res.status(404).json({ message: 'Client options not found' });
    }
    
    const decodedValue = decodeURIComponent(optionValue);
    options[category] = options[category].filter(
      o => o.value.toLowerCase() !== decodedValue.toLowerCase()
    );
    
    await options.save();
    
    res.json({
      message: 'Option deleted successfully',
      options: options[category]
    });
  } catch (error) {
    console.error('Error deleting option:', error);
    res.status(500).json({ message: 'Error deleting option', error: error.message });
  }
});

// ================= Bulk Setup for Multiple Clients (Admin) =================
router.post('/bulk-setup', authenticateUser, async (req, res) => {
  try {
    const { clientConfigs } = req.body;
    
    if (!Array.isArray(clientConfigs)) {
      return res.status(400).json({ message: 'clientConfigs array is required' });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const config of clientConfigs) {
      try {
        const { client_id, client_name, request_types, requestor_types, process_types } = config;
        
        if (!client_id) {
          results.failed.push({ config, error: 'Missing client_id' });
          continue;
        }
        
        // Verify client exists
        const client = await Client.findById(client_id);
        if (!client) {
          results.failed.push({ client_id, error: 'Client not found' });
          continue;
        }
        
        await ClientDropdownOptions.findOneAndUpdate(
          { client_id },
          {
            client_id,
            client_name: client_name || client.name,
            request_types: request_types || [],
            requestor_types: requestor_types || [],
            process_types: process_types || []
          },
          { upsert: true, new: true }
        );
        
        results.success.push({ client_id, client_name: client.name });
      } catch (err) {
        results.failed.push({ config, error: err.message });
      }
    }
    
    res.json({
      message: 'Bulk setup completed',
      results
    });
  } catch (error) {
    console.error('Error in bulk setup:', error);
    res.status(500).json({ message: 'Error in bulk setup', error: error.message });
  }
});

// ================= Copy Options from One Client to Another (Admin) =================
router.post('/copy/:sourceClientId/:targetClientId', authenticateUser, async (req, res) => {
  try {
    const { sourceClientId, targetClientId } = req.params;
    
    const sourceOptions = await ClientDropdownOptions.findOne({ client_id: sourceClientId });
    if (!sourceOptions) {
      return res.status(404).json({ message: 'Source client options not found' });
    }
    
    const targetClient = await Client.findById(targetClientId);
    if (!targetClient) {
      return res.status(404).json({ message: 'Target client not found' });
    }
    
    await ClientDropdownOptions.findOneAndUpdate(
      { client_id: targetClientId },
      {
        client_id: targetClientId,
        client_name: targetClient.name,
        request_types: sourceOptions.request_types,
        requestor_types: sourceOptions.requestor_types,
        process_types: sourceOptions.process_types,
        custom_fields: sourceOptions.custom_fields
      },
      { upsert: true, new: true }
    );
    
    res.json({
      message: `Options copied from ${sourceOptions.client_name} to ${targetClient.name}`
    });
  } catch (error) {
    console.error('Error copying options:', error);
    res.status(500).json({ message: 'Error copying options', error: error.message });
  }
});

module.exports = router;
