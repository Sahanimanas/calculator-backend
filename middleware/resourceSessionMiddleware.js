// middleware/resourceSessionMiddleware.js - Session timeout middleware for resources
const jwt = require('jsonwebtoken');
const Resource = require('../models/Resource');

const SESSION_TIMEOUT_MINUTES = 10; // 10 minutes inactivity timeout

/**
 * Middleware to authenticate resource and check session timeout
 * This should be used for all resource-protected routes
 */
const authenticateResourceWithTimeout = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        message: 'Access denied. No token provided.',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          message: 'Session expired. Please login again.',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({ 
        message: 'Invalid token.',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if it's a resource token
    if (decoded.type !== 'resource') {
      return res.status(401).json({ 
        message: 'Invalid token type.',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    // Find the resource
    const resource = await Resource.findById(decoded.id).select('-otp');
    if (!resource) {
      return res.status(401).json({ 
        message: 'Resource not found.',
        code: 'RESOURCE_NOT_FOUND'
      });
    }

    // Check if resource is active
    if (resource.status !== 'active') {
      return res.status(401).json({ 
        message: 'Account is inactive. Please contact administrator.',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Check if session token matches (optional - for single session enforcement)
    if (resource.current_session_token && resource.current_session_token !== token) {
      return res.status(401).json({ 
        message: 'Session invalidated. You may have logged in from another device.',
        code: 'SESSION_INVALIDATED'
      });
    }

    // Check for session timeout due to inactivity
    if (!resource.isSessionValid()) {
      // Invalidate the session
      resource.invalidateSession();
      await resource.save();
      
      return res.status(401).json({ 
        message: 'Session timed out due to inactivity. Please login again.',
        code: 'SESSION_TIMEOUT',
        timeout: true
      });
    }

    // Session is valid - update last activity time
    resource.last_activity = new Date();
    await resource.save();

    // Attach resource to request
    req.resource = resource;
    req.resourceId = resource._id;

    // Add remaining session time to response headers (optional - for frontend use)
    const remainingTime = resource.getRemainingSessionTime();
    res.set('X-Session-Remaining', remainingTime.toString());
    res.set('X-Session-Timeout', (SESSION_TIMEOUT_MINUTES * 60).toString());

    next();
  } catch (error) {
    console.error('Resource authentication error:', error);
    return res.status(500).json({ 
      message: 'Authentication error.',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware to update activity without full authentication
 * Use this for lightweight activity ping endpoints
 */
const updateResourceActivity = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Skip if no token
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      
      if (decoded.type === 'resource') {
        // Update activity in background (don't wait)
        Resource.findByIdAndUpdate(
          decoded.id,
          { last_activity: new Date() },
          { new: false }
        ).exec().catch(err => console.error('Activity update error:', err));
      }
    } catch (err) {
      // Token invalid, skip
    }

    next();
  } catch (error) {
    next();
  }
};

/**
 * Endpoint handler to check session status
 */
const checkSessionStatus = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ 
        valid: false, 
        message: 'No token provided',
        code: 'NO_TOKEN'
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (jwtError) {
      return res.json({ 
        valid: false, 
        message: 'Token expired or invalid',
        code: jwtError.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN'
      });
    }

    if (decoded.type !== 'resource') {
      return res.json({ 
        valid: false, 
        message: 'Invalid token type',
        code: 'INVALID_TOKEN_TYPE'
      });
    }

    const resource = await Resource.findById(decoded.id).select('last_activity session_timeout_minutes status name email');
    
    if (!resource) {
      return res.json({ 
        valid: false, 
        message: 'Resource not found',
        code: 'RESOURCE_NOT_FOUND'
      });
    }

    if (resource.status !== 'active') {
      return res.json({ 
        valid: false, 
        message: 'Account inactive',
        code: 'ACCOUNT_INACTIVE'
      });
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
    console.error('Session check error:', error);
    return res.status(500).json({ 
      valid: false, 
      message: 'Error checking session',
      code: 'ERROR'
    });
  }
};

/**
 * Endpoint handler to refresh/extend session
 */
const refreshSession = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: 'No token provided' 
      });
    }

    const token = authHeader.split(' ')[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    } catch (jwtError) {
      return res.status(401).json({ 
        success: false, 
        message: 'Token expired or invalid' 
      });
    }

    if (decoded.type !== 'resource') {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid token type' 
      });
    }

    const resource = await Resource.findById(decoded.id);
    
    if (!resource || resource.status !== 'active') {
      return res.status(401).json({ 
        success: false, 
        message: 'Resource not found or inactive' 
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
    return res.status(500).json({ 
      success: false, 
      message: 'Error refreshing session' 
    });
  }
};

/**
 * Endpoint handler to logout (invalidate session)
 */
const logoutResource = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.json({ success: true, message: 'Already logged out' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      
      if (decoded.type === 'resource') {
        const resource = await Resource.findById(decoded.id);
        if (resource) {
          resource.invalidateSession();
          await resource.save();
        }
      }
    } catch (err) {
      // Token invalid, but still consider logout successful
    }

    return res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Error during logout' 
    });
  }
};

module.exports = {
  authenticateResourceWithTimeout,
  updateResourceActivity,
  checkSessionStatus,
  refreshSession,
  logoutResource,
  SESSION_TIMEOUT_MINUTES
};