const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET; // use env var in production

// Hardcoded user credentials
const HARD_CODED_USER = {
  email: 'admin@gmail.com',
  password: 'admin123', // in real apps, never store plain passwords
  full_name: 'Admin User',
  role: 'admin'
};

// ================= Login =================
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  // Check if input matches hardcoded credentials
  if (email === HARD_CODED_USER.email && password === HARD_CODED_USER.password) {
    const token = jwt.sign(
      { id: 1, email: HARD_CODED_USER.email, role: HARD_CODED_USER.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        full_name: HARD_CODED_USER.full_name,
        email: HARD_CODED_USER.email,
        role: HARD_CODED_USER.role
      }
    });
  } else {
    return res.status(401).json({ message: 'Invalid credentials' });
  }
});

router.post('/register', (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password || !full_name || !role) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const user = new User({
    email,
    password_hash: password, // In real apps, hash the password
    full_name,
    role
  });

  user.save().then(() => {
  }).catch(err => {
    console.error(err);
    return res.status(500).json({ message: 'Error registering user' });
  });

  const token = jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  
  return res.status(201).json({
    user: {
      email,
      full_name,
      role
    }
  });
});


module.exports = router;
