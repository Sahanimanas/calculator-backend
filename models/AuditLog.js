const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // who made the change
  action: { type: String, required: true }, // create / update / delete
  collection_name: { type: String, required: true }, // e.g., 'Project', 'Subproject'
  document_id: { type: mongoose.Schema.Types.ObjectId, required: true }, // id of the affected document
  changes: { type: Object }, // details of the changes, can be old vs new values
  ip_address: String, // optional: track the IP of the user
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AuditLog', AuditLogSchema);
  