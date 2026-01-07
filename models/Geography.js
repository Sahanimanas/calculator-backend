// models/Geography.js
const mongoose = require('mongoose');

const GeographySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  description: String,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
}, { timestamps: { createdAt: 'created_on', updatedAt: 'updated_at' } });

module.exports = mongoose.model('Geography', GeographySchema);