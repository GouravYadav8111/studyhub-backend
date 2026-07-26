const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
// Adjust this import path if your auth middleware file is named differently
const authMiddleware = require('../middleware/authMiddleware'); 
const Library = require('../models/Library');

// POST: Generate Prorated Razorpay Order
router.post('/create-order', authMiddleware, async (req, res) => {
  try {
    const { library_id, seat_number } = req.body;
    const library = await Library.findById(library_id);

    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // 1. Fetch Owner's Razorpay Credentials
    const rzpKey = library.payment_settings?.razorpay_key_id;
    const rzpSecret = library.payment_settings?.razorpay_key_secret;

    if (!rzpKey || !rzpSecret) {
      return res.status(400).json({ 
        error: 'This library does not accept online payments yet. Please select Cash at Counter.' 
      });
    }

    // 2. Proration Math Engine
    const monthlyRate = library.pricing?.monthly_rate || 1000;
    
    // Calculate days remaining in the current calendar month
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const daysRemaining = daysInMonth - today.getDate() + 1; // +1 includes today

    // Calculate exact prorated amount (Rate / 30 * Remaining Days)
    const dailyRate = monthlyRate / 30;
    const proratedAmount = Math.round(dailyRate * daysRemaining);

    // 3. Initialize Razorpay using the OWNER'S keys (Direct Payout Model)
    const razorpayInstance = new Razorpay({
      key_id: rzpKey,
      key_secret: rzpSecret,
    });

    // 4. Generate the Official Order
    const options = {
      amount: proratedAmount * 100, // Razorpay requires the amount in paise (multiply by 100)
      currency: 'INR',
      receipt: `rcpt_${library_id.slice(-4)}_${seat_number}_${Date.now().toString().slice(-4)}`,
    };

    const order = await razorpayInstance.orders.create(options);

    // 5. Send order payload to the frontend Checkout Modal
    res.status(200).json({
      success: true,
      order_id: order.id,
      amount: proratedAmount,
      base_rate: monthlyRate,
      days_remaining: daysRemaining,
      currency: order.currency,
      key_id: rzpKey // Frontend needs this specific key to open the gateway
    });

  } catch (error) {
    console.error("Razorpay Order Generation Error:", error);
    res.status(500).json({ error: 'Failed to connect to payment gateway.' });
  }
});

module.exports = router;