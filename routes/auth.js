const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User'); 
const authMiddleware = require('../middleware/authMiddleware');

// --- 1. POST: Register a new user ---
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists with this email.' });
    }

    // Hash the password for security
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the new user
    user = new User({
      name,
      email,
      password: hashedPassword,
      role: role || 'Student' 
    });

    await user.save();

    // Generate JWT Token
    const payload = { user: { id: user.id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Send back the token and user data to React
    res.status(201).json({ 
      token, 
      user: { _id: user.id, name: user.name, email: user.email, role: user.role } 
    });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: 'Server error during registration.' });
  }
});

// --- 2. POST: Login an existing user ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid Email or Password.' });
    }

    // Compare the entered password with the hashed password in DB
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid Email or Password.' });
    }

    // Generate JWT Token
    const payload = { user: { id: user.id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Send back the token and user data to React
    res.json({ 
      token, 
      user: { _id: user.id, name: user.name, email: user.email, role: user.role } 
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

// --- 3. GET: Get current logged-in user data (Optional helper) ---
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    console.error("Fetch User Error:", err);
    res.status(500).json({ message: 'Server error fetching user data.' });
  }
});

module.exports = router;