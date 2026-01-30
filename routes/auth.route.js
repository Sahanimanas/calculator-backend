// routes/auth.js - Updated with OTP-based resource login and session timeout management
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Resource = require('../models/Resource');
const { sendOTPEmail, sendOTPEmailDevelopment } = require('../services/emailService');

const JWT_SECRET = process.env.JWT_SECRET;
const SESSION_TIMEOUT_MINUTES = 10; // 10 minutes inactivity timeout for resources

// Helper to extract client info
const getClientInfo = (req) => ({
  ip_address: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
  user_agent: req.headers['user-agent'] || 'unknown',
  device_info: req.headers['x-device-info'] || 'unknown',
  location: req.headers['x-location'] || 'unknown'
});

// ================= Admin/User Login (Password-based) =================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Update last login
    user.last_login = new Date();
    await user.save();

    const token = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: user.role,
        userType: 'admin'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      userType: 'admin',
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

// ================= Resource: Request OTP =================
router.post('/resource-request-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const resource = await Resource.findOne({ email: email.toLowerCase() });
    
    if (!resource) {
      // Don't reveal if email exists or not for security
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid email or OTP' 
      });
    }

    // Check if account is active
    if (resource.status === 'inactive') {
      return res.status(403).json({ message: 'Account is inactive. Please contact admin.' });
    }

    if (resource.status === 'pending') {
      return res.status(403).json({ message: 'Account is pending approval. Please contact admin.' });
    }

    // Check rate limiting (1 OTP per minute)
    if (!Resource.canSendOTP(resource)) {
      const waitTime = Math.ceil((60000 - (Date.now() - resource.otp_last_sent.getTime())) / 1000);
      return res.status(429).json({ 
        message: `Please wait ${waitTime} seconds before requesting another OTP.` 
      });
    }

    // Generate OTP
    const otp = resource.generateOTP();
    await resource.save();

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otp, resource.name);
    
    if (!emailResult.success) {
      console.error('Failed to send OTP email:', emailResult.error);
      // Still return success to not reveal system issues
    }

    // Log OTP request
    console.log(`OTP requested for ${email}`);

    return res.json({
      success: true,
      message: 'OTP sent to your email. Please check your inbox.',
    });
  } catch (error) {
    console.error('OTP request error:', error);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ================= Resource: Verify OTP and Login =================
router.post('/resource-verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const resource = await Resource.findOne({ email: email.toLowerCase() });
    
    if (!resource) {
      return res.status(401).json({ message: 'Invalid email or OTP' });
    }

    // Verify OTP
    const verifyResult = resource.verifyOTP(otp);
    
    if (!verifyResult.valid) {
      await resource.save(); // Save updated attempts
      return res.status(401).json({ message: verifyResult.message });
    }

    // OTP verified - record login activity
    const clientInfo = getClientInfo(req);
    resource.recordLogin(clientInfo);

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: resource._id, 
        email: resource.email, 
        role: resource.role,
        name: resource.name,
        userType: 'resource'
      },
      JWT_SECRET,
      { expiresIn: '24h' } // Token expiry (longer since we use activity-based timeout)
    );

    // Set session management fields for inactivity timeout
    resource.current_session_token = token;
    resource.session_expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    resource.last_activity = new Date(); // Start activity tracking
    resource.session_timeout_minutes = SESSION_TIMEOUT_MINUTES;

    await resource.save();

    console.log(`Resource logged in: ${email} (Total logins: ${resource.total_logins})`);

    return res.json({
      success: true,
      token,
      userType: 'resource',
      resource: {
        id: resource._id,
        email: resource.email,
        name: resource.name,
        role: resource.role,
        assignments: resource.assignments,
        login_count: resource.total_logins,
        last_login: resource.last_login
      },
      session: {
        timeout_minutes: SESSION_TIMEOUT_MINUTES,
        expires_at: resource.session_expires
      }
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    return res.status(500).json({ message: 'Server error during login' });
  }
});

// ================= Admin/User Registration =================
router.post('/register', async (req, res) => {
  try {
    const { email, password, full_name, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = new User({
      email: email.toLowerCase(),
      password_hash,
      full_name,
      role: role || 'user'
    });

    await user.save();

    return res.status(201).json({
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ message: 'Error registering user' });
  }
});

// ================= Create Resource (Admin) =================
router.post('/register-resource', async (req, res) => {
  try {
    const { email, name, role, employee_id, assignments } = req.body;

    if (!email || !name) {
      return res.status(400).json({ message: 'Email and name are required' });
    }

    const existingResource = await Resource.findOne({ email: email.toLowerCase() });
    if (existingResource) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    // No password needed - OTP based login
    const resource = new Resource({
      email: email.toLowerCase(),
      name,
      role: role || 'associate',
      employee_id,
      assignments: assignments || [],
      status: 'active',
      login_count: 0,
      total_logins: 0,
      session_timeout_minutes: SESSION_TIMEOUT_MINUTES
    });

    await resource.save();

    return res.status(201).json({
      message: 'Resource registered successfully',
      resource: {
        id: resource._id,
        email: resource.email,
        name: resource.name
      }
    });
  } catch (error) {
    console.error('Resource registration error:', error);
    return res.status(500).json({ message: 'Error registering resource' });
  }
});

// ================= Verify Token =================
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ valid: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.userType === 'admin') {
      const user = await User.findById(decoded.id).select('-password_hash');
      if (!user) {
        return res.status(401).json({ valid: false, message: 'User not found' });
      }
      return res.json({ valid: true, userType: 'admin', user });
    } else if (decoded.userType === 'resource') {
      const resource = await Resource.findById(decoded.id).select('-otp -otp_expires');
      if (!resource) {
        return res.status(401).json({ valid: false, message: 'Resource not found' });
      }

      // Check for session timeout due to inactivity
      if (!resource.isSessionValid()) {
        // Invalidate the session
        resource.invalidateSession();
        await resource.save();
        
        return res.status(401).json({ 
          valid: false, 
          message: 'Session timed out due to inactivity. Please login again.',
          code: 'SESSION_TIMEOUT',
          timeout: true
        });
      }

      // Update last activity
      resource.last_activity = new Date();
      await resource.save();

      return res.json({ 
        valid: true, 
        userType: 'resource', 
        resource: {
          id: resource._id,
          email: resource.email,
          name: resource.name,
          role: resource.role,
          assignments: resource.assignments,
          login_count: resource.total_logins,
          last_login: resource.last_login
        },
        session: {
          remaining_seconds: resource.getRemainingSessionTime(),
          timeout_minutes: resource.session_timeout_minutes || SESSION_TIMEOUT_MINUTES
        }
      });
    }
    
    return res.status(401).json({ valid: false, message: 'Invalid token type' });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ valid: false, message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ valid: false, message: 'Invalid token' });
  }
});

// ================= Resource: Resend OTP =================
router.post('/resource-resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const resource = await Resource.findOne({ email: email.toLowerCase() });
    
    if (!resource) {
      return res.json({ 
        success: true, 
        message: 'If your email is registered, you will receive a new OTP shortly.' 
      });
    }

    // Check rate limiting
    if (!Resource.canSendOTP(resource)) {
      const waitTime = Math.ceil((60000 - (Date.now() - resource.otp_last_sent.getTime())) / 1000);
      return res.status(429).json({ 
        message: `Please wait ${waitTime} seconds before requesting another OTP.` 
      });
    }

    // Generate new OTP
    const otp = resource.generateOTP();
    await resource.save();

    // Send OTP email
    await sendOTPEmail(email, otp, resource.name);

    return res.json({
      success: true,
      message: 'New OTP sent to your email.',
      ...(process.env.NODE_ENV !== 'production' && { dev_otp: otp })
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({ message: 'Server error. Please try again.' });
  }
});

// ================= Get Resource Login Stats (for logged-in resource) =================
router.get('/resource-login-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.userType !== 'resource') {
      return res.status(403).json({ message: 'Resource access required' });
    }
    
    const resource = await Resource.findById(decoded.id)
      .select('name email total_logins login_count last_login login_history monthly_logins last_activity session_timeout_minutes');
    
    if (!resource) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    // Check session timeout
    if (!resource.isSessionValid()) {
      resource.invalidateSession();
      await resource.save();
      return res.status(401).json({ 
        message: 'Session timed out due to inactivity',
        code: 'SESSION_TIMEOUT'
      });
    }

    // Update activity
    resource.last_activity = new Date();
    await resource.save();
    
    return res.json({
      name: resource.name,
      email: resource.email,
      total_logins: resource.total_logins,
      last_login: resource.last_login,
      recent_logins: resource.login_history.slice(0, 10),
      monthly_stats: resource.monthly_logins,
      session: {
        remaining_seconds: resource.getRemainingSessionTime(),
        timeout_minutes: resource.session_timeout_minutes || SESSION_TIMEOUT_MINUTES
      }
    });
  } catch (error) {
    console.error('Get login stats error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});

// ================= Resource: Check Session Status =================
router.get('/resource-session-status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ valid: false, message: 'No token provided', code: 'NO_TOKEN' });
    }
    
    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      return res.json({ 
        valid: false, 
        message: 'Token expired or invalid',
        code: jwtError.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      });
    }
    
    if (decoded.userType !== 'resource') {
      return res.json({ valid: false, message: 'Invalid token type', code: 'INVALID_TOKEN_TYPE' });
    }
    
    const resource = await Resource.findById(decoded.id)
      .select('last_activity session_timeout_minutes status name email');
    
    if (!resource) {
      return res.json({ valid: false, message: 'Resource not found', code: 'RESOURCE_NOT_FOUND' });
    }
    
    if (resource.status !== 'active') {
      return res.json({ valid: false, message: 'Account inactive', code: 'ACCOUNT_INACTIVE' });
    }
    
    const isValid = resource.isSessionValid();
    const remainingSeconds = resource.getRemainingSessionTime();
    
    if (!isValid) {
      // Invalidate session
      resource.invalidateSession();
      await resource.save();
    }
    
    return res.json({
      valid: isValid,
      remaining_seconds: remainingSeconds,
      timeout_minutes: resource.session_timeout_minutes || SESSION_TIMEOUT_MINUTES,
      resource: isValid ? {
        id: resource._id,
        name: resource.name,
        email: resource.email
      } : null,
      code: isValid ? 'SESSION_VALID' : 'SESSION_TIMEOUT'
    });
  } catch (error) {
    console.error('Session status check error:', error);
    return res.status(500).json({ valid: false, message: 'Error checking session', code: 'ERROR' });
  }
});

// ================= Resource: Refresh/Ping Session =================
router.post('/resource-session-refresh', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtError) {
      return res.status(401).json({ success: false, message: 'Token expired or invalid' });
    }
    
    if (decoded.userType !== 'resource') {
      return res.status(401).json({ success: false, message: 'Invalid token type' });
    }
    
    const resource = await Resource.findById(decoded.id);
    
    if (!resource || resource.status !== 'active') {
      return res.status(401).json({ success: false, message: 'Resource not found or inactive' });
    }

    // Check if session already timed out
    if (!resource.isSessionValid()) {
      resource.invalidateSession();
      await resource.save();
      return res.status(401).json({ 
        success: false, 
        message: 'Session timed out due to inactivity',
        code: 'SESSION_TIMEOUT'
      });
    }
    
    // Update activity time (refresh session)
    resource.last_activity = new Date();
    await resource.save();
    
    const remainingSeconds = resource.getRemainingSessionTime();
    
    return res.json({
      success: true,
      message: 'Session refreshed',
      remaining_seconds: remainingSeconds,
      timeout_minutes: resource.session_timeout_minutes || SESSION_TIMEOUT_MINUTES
    });
  } catch (error) {
    console.error('Session refresh error:', error);
    return res.status(500).json({ success: false, message: 'Error refreshing session' });
  }
});

// ================= Resource: Logout =================
router.post('/resource-logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ success: true, message: 'Already logged out' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      
      if (decoded.userType === 'resource') {
        const resource = await Resource.findById(decoded.id);
        if (resource) {
          resource.invalidateSession();
          await resource.save();
          console.log(`Resource logged out: ${resource.email}`);
        }
      }
    } catch (err) {
      // Token invalid, but still consider logout successful
    }
    
    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ success: false, message: 'Error during logout' });
  }
});

module.exports = router;