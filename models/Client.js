// models/Client.js
const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: String,
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  geography_name: String, // Denormalized for quick access
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

// Ensure unique client name per geography
ClientSchema.index({ geography_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Client', ClientSchema);