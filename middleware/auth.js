// middleware/auth.js - Authentication middleware for both Users and Resources
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Resource = require('../models/Resource');

const JWT_SECRET = process.env.JWT_SECRET ;

// Middleware to verify JWT token (generic)
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware specifically for Admin/User authentication
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if it's a user (admin) token
    if (decoded.userType !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const user = await User.findById(decoded.id).select('-password_hash');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    req.user = user;
    req.userType = 'admin';
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware specifically for Resource authentication
const authenticateResource = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check if it's a resource token
    if (decoded.userType !== 'resource') {
      return res.status(403).json({ message: 'Resource access required' });
    }
    
    const resource = await Resource.findById(decoded.id).select('-password_hash');
    if (!resource) {
      return res.status(401).json({ message: 'Resource not found' });
    }
    
    if (resource.status !== 'active') {
      return res.status(403).json({ message: 'Resource account is not active' });
    }
    
    req.resource = resource;
    req.userType = 'resource';
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Combined middleware - allows either admin or resource
const authenticateAny = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.userType === 'admin') {
      const user = await User.findById(decoded.id).select('-password_hash');
      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }
      req.user = user;
      req.userType = 'admin';
    } else if (decoded.userType === 'resource') {
      const resource = await Resource.findById(decoded.id).select('-password_hash');
      if (!resource) {
        return res.status(401).json({ message: 'Resource not found' });
      }
      if (resource.status !== 'active') {
        return res.status(403).json({ message: 'Resource account is not active' });
      }
      req.resource = resource;
      req.userType = 'resource';
    } else {
      return res.status(403).json({ message: 'Invalid user type' });
    }
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Middleware to check if resource has access to specific subproject
const checkSubprojectAccess = async (req, res, next) => {
  try {
    const subprojectId = req.params.subprojectId || req.body.subproject_id;
    
    if (!subprojectId) {
      return res.status(400).json({ message: 'Subproject ID required' });
    }
    
    // Admins have full access
    if (req.userType === 'admin') {
      return next();
    }
    
    // Check if resource has access
    if (req.resource && !req.resource.hasAccessToSubproject(subprojectId)) {
      return res.status(403).json({ message: 'Access denied to this location' });
    }
    
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Error checking access', error: error.message });
  }
};

module.exports = {
  verifyToken,
  authenticateUser,
  authenticateResource,
  authenticateAny,
  checkSubprojectAccess
};
