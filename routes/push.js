const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const Subscription = require('../models/Subscription');
const authMiddleware = require('../middleware/authMiddleware');

// Configure VAPID Keys
webpush.setVapidDetails(
  process.env.VAPID_EMAIL || 'mailto:support@studyhub.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 📌 1. Save or Update User's Mobile/Browser Device Token
router.post('/subscribe', authMiddleware, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ message: 'Invalid subscription object.' });
    }

    // Upsert subscription per endpoint
    await Subscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        user_id: req.user.id,
        endpoint: subscription.endpoint,
        keys: subscription.keys
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ message: 'Push subscription saved successfully.' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 📌 2. Send Public Key to Frontend
router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

module.exports = router;