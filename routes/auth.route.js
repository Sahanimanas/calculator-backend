const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const JWT_SECRET = process.env.JWT_SECRET; // use env var in production

// Hardcoded user credentials

// ================= Login =================
router.post('/login', async(req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required' });
  }

  const user= await User.findOne({ email: email, password_hash: password });
  console.log(user);

  // Check if input matches hardcoded credentials
  if (!user) {return res.status(401).json({ message: 'Invalid credentials' });}

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: {
        id: user._id,
        email: user.email
      }
    });
  
});

router.post('/register', (req, res) => {
  const { email, password, full_name, role } = req.body;

  if (!email || !password ) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const user = new User({
    email,
    password_hash: password, // In real apps, hash the password

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
   message: 'User registered successfully',
  });
});


module.exports = router;
