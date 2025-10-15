// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  full_name: { type: String },
  email: { type: String, required: true, unique: true },
  role: { type: String},
  status: { type: String, default: 'active' },
  avatar_url: String,
  password_hash: { type: String, required: true },
  last_login: Date,
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('User', UserSchema);
