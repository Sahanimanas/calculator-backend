// models/ClientDropdownOptions.js - Client-specific dropdown options
const mongoose = require('mongoose');

const DropdownOptionSchema = new mongoose.Schema({
  value: { type: String, required: true },
  label: { type: String }, // Display label (defaults to value if not provided)
  is_active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 }
}, { _id: false });

const ClientDropdownOptionsSchema = new mongoose.Schema({
  client_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Client', 
    required: true,
    unique: true 
  },
  client_name: { type: String, required: true },
  
  // Request Type options for this client
  request_types: [DropdownOptionSchema],
  
  // Requestor Type options for this client
  requestor_types: [DropdownOptionSchema],
  
  // Process Type options for this client
  process_types: [DropdownOptionSchema],
  
  // Additional custom fields if needed in future
  custom_fields: [{
    field_name: String,
    field_label: String,
    field_type: { type: String, enum: ['dropdown', 'text', 'number', 'date'] },
    options: [DropdownOptionSchema],
    is_required: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true }
  }]
  
}, { timestamps: true });

// Index for faster lookups
ClientDropdownOptionsSchema.index({ client_id: 1 });

// Static method to get options for a client (with fallback to defaults)
ClientDropdownOptionsSchema.statics.getOptionsForClient = async function(clientId) {
  let options = await this.findOne({ client_id: clientId });
  
  if (!options) {
    // Return default options if client doesn't have custom ones
    return {
      client_id: clientId,
      request_types: [
        { value: 'New Request', label: 'New Request', is_active: true, sort_order: 0 },
        { value: 'Follow up', label: 'Follow up', is_active: true, sort_order: 1 },
        { value: 'Batch', label: 'Batch', is_active: true, sort_order: 2 }
      ],
      requestor_types: [
        { value: 'Processed', label: 'Processed', is_active: true, sort_order: 0 }
      ],
      process_types: [
        { value: 'Logging', label: 'Logging', is_active: true, sort_order: 0 },
        { value: 'Processing', label: 'Processing', is_active: true, sort_order: 1 }
      ],
      custom_fields: []
    };
  }
  
  return options;
};

module.exports = mongoose.model('ClientDropdownOptions', ClientDropdownOptionsSchema);
