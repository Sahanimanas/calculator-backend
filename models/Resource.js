// models/Resource.js - Updated with OTP authentication, login tracking, and session timeout
const mongoose = require('mongoose');

// Login activity subdocument
const LoginActivitySchema = new mongoose.Schema({
  login_time: { type: Date, default: Date.now },
  ip_address: { type: String },
  user_agent: { type: String },
  device_info: { type: String },
  location: { type: String },
  status: { type: String, enum: ['success', 'failed', 'otp_sent'], default: 'success' }
}, { _id: false });

// Assignment subdocument - defines what a resource can access
const AssignmentSchema = new mongoose.Schema({
  geography_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Geography', required: true },
  geography_name: { type: String },
  client_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  client_name: { type: String },
  project_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
  project_name: { type: String },
  // Array of subprojects/locations this resource can access
  subprojects: [{
    subproject_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Subproject' },
    subproject_name: { type: String }
  }]
}, { _id: false });

const ResourceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  
  // OTP Authentication fields
  otp: { type: String },
  otp_expires: { type: Date },
  otp_attempts: { type: Number, default: 0 },
  otp_last_sent: { type: Date },
  
  // Role within the system
  role: { 
    type: String, 
    enum: ['associate', 'senior_associate', 'team_lead', 'manager'],
    default: 'associate'
  },
  
  // Status
  status: { 
    type: String, 
    enum: ['active', 'inactive', 'pending'],
    default: 'active'
  },
  
  // Assignments - what this resource can access
  assignments: [AssignmentSchema],
  
  // Additional info
  employee_id: { type: String },
  phone: { type: String },
  avatar_url: { type: String },
  
  // Login tracking
  last_login: { type: Date },
  login_count: { type: Number, default: 0 },
  total_logins: { type: Number, default: 0 },
  
  // Login activity history (last 50 logins)
  login_history: {
    type: [LoginActivitySchema],
    default: []
  },
  
  // Monthly login stats
  monthly_logins: [{
    month: Number,
    year: Number,
    count: { type: Number, default: 0 },
    first_login: Date,
    last_login: Date
  }],
  
  // Session management with activity tracking
  current_session_token: { type: String },
  session_expires: { type: Date },
  last_activity: { type: Date },  // Track last activity for timeout
  session_timeout_minutes: { type: Number, default: 10 }  // Configurable timeout (default 10 min)
  
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

// Index for faster queries
ResourceSchema.index({ email: 1 });
ResourceSchema.index({ status: 1 });
ResourceSchema.index({ 'assignments.client_id': 1 });
ResourceSchema.index({ 'assignments.subprojects.subproject_id': 1 });
ResourceSchema.index({ otp: 1, otp_expires: 1 });
ResourceSchema.index({ current_session_token: 1 });
ResourceSchema.index({ last_activity: 1 });

// Method to generate OTP
ResourceSchema.methods.generateOTP = function() {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.otp = otp;
  this.otp_expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
  this.otp_attempts = 0;
  this.otp_last_sent = new Date();
  return otp;
};

// Method to verify OTP
ResourceSchema.methods.verifyOTP = function(inputOTP) {
  // Check if OTP exists and hasn't expired
  if (!this.otp || !this.otp_expires) {
    return { valid: false, message: 'No OTP requested. Please request a new OTP.' };
  }
  
  // Check if OTP has expired
  if (new Date() > this.otp_expires) {
    return { valid: false, message: 'OTP has expired. Please request a new OTP.' };
  }
  
  // Check attempts (max 3)
  if (this.otp_attempts >= 3) {
    return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' };
  }
  
  // Verify OTP
  if (this.otp !== inputOTP) {
    this.otp_attempts += 1;
    return { valid: false, message: `Invalid OTP. ${3 - this.otp_attempts} attempts remaining.` };
  }
  
  // OTP is valid - clear it
  this.otp = undefined;
  this.otp_expires = undefined;
  this.otp_attempts = 0;
  
  return { valid: true, message: 'OTP verified successfully' };
};

// Method to record login activity
ResourceSchema.methods.recordLogin = function(loginData = {}) {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  
  // Update login counts
  this.login_count += 1;
  this.total_logins += 1;
  this.last_login = now;
  this.last_activity = now;  // Set initial activity time
  
  // Add to login history (keep last 50)
  const loginEntry = {
    login_time: now,
    ip_address: loginData.ip_address || 'unknown',
    user_agent: loginData.user_agent || 'unknown',
    device_info: loginData.device_info || 'unknown',
    location: loginData.location || 'unknown',
    status: 'success'
  };
  
  this.login_history.unshift(loginEntry);
  if (this.login_history.length > 50) {
    this.login_history = this.login_history.slice(0, 50);
  }
  
  // Update monthly stats
  const monthlyIndex = this.monthly_logins.findIndex(
    m => m.month === currentMonth && m.year === currentYear
  );
  
  if (monthlyIndex >= 0) {
    this.monthly_logins[monthlyIndex].count += 1;
    this.monthly_logins[monthlyIndex].last_login = now;
  } else {
    this.monthly_logins.push({
      month: currentMonth,
      year: currentYear,
      count: 1,
      first_login: now,
      last_login: now
    });
  }
  
  // Keep only last 12 months of stats
  if (this.monthly_logins.length > 12) {
    this.monthly_logins = this.monthly_logins.slice(-12);
  }
};

// Method to update last activity (call this on each API request)
ResourceSchema.methods.updateActivity = function() {
  this.last_activity = new Date();
};

// Method to check if session is still valid (not timed out)
ResourceSchema.methods.isSessionValid = function() {
  if (!this.last_activity) {
    return false;
  }
  
  const now = new Date();
  const timeoutMs = (this.session_timeout_minutes || 10) * 60 * 1000; // Default 10 minutes
  const timeSinceActivity = now.getTime() - this.last_activity.getTime();
  
  return timeSinceActivity < timeoutMs;
};

// Method to get remaining session time in seconds
ResourceSchema.methods.getRemainingSessionTime = function() {
  if (!this.last_activity) {
    return 0;
  }
  
  const now = new Date();
  const timeoutMs = (this.session_timeout_minutes || 10) * 60 * 1000;
  const timeSinceActivity = now.getTime() - this.last_activity.getTime();
  const remainingMs = timeoutMs - timeSinceActivity;
  
  return Math.max(0, Math.floor(remainingMs / 1000));
};

// Method to invalidate session (logout)
ResourceSchema.methods.invalidateSession = function() {
  this.current_session_token = undefined;
  this.session_expires = undefined;
  this.last_activity = undefined;
};

// Method to check if resource has access to a specific subproject
ResourceSchema.methods.hasAccessToSubproject = function(subprojectId) {
  const subprojectIdStr = subprojectId.toString();
  return this.assignments.some(assignment => 
    assignment.subprojects.some(sp => 
      sp.subproject_id.toString() === subprojectIdStr
    )
  );
};

// Method to get all accessible subproject IDs
ResourceSchema.methods.getAccessibleSubprojectIds = function() {
  const ids = [];
  this.assignments.forEach(assignment => {
    assignment.subprojects.forEach(sp => {
      ids.push(sp.subproject_id);
    });
  });
  return ids;
};

// Static method to check if can send OTP (rate limiting)
ResourceSchema.statics.canSendOTP = function(resource) {
  if (!resource.otp_last_sent) return true;
  
  const timeSinceLastOTP = Date.now() - resource.otp_last_sent.getTime();
  const minInterval = 60 * 1000; // 1 minute between OTP requests
  
  return timeSinceLastOTP >= minInterval;
};

// Static method to invalidate expired sessions (can be run as a cron job)
ResourceSchema.statics.invalidateExpiredSessions = async function() {
  const defaultTimeoutMinutes = 10;
  const cutoffTime = new Date(Date.now() - defaultTimeoutMinutes * 60 * 1000);
  
  const result = await this.updateMany(
    {
      last_activity: { $lt: cutoffTime },
      current_session_token: { $exists: true, $ne: null }
    },
    {
      $unset: {
        current_session_token: 1,
        session_expires: 1,
        last_activity: 1
      }
    }
  );
  
  return result;
};

module.exports = mongoose.model('Resource', ResourceSchema);