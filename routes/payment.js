const express = require('express');
const router = express.Router();
const Razorpay = require('razorpay');
// Adjust this import path if your auth middleware file is named differently
const authMiddleware = require('../middleware/authMiddleware'); 
const Library = require('../models/Library');

// 👇 NEW IMPORTS ADDED HERE
const crypto = require('crypto');
const Enrollment = require('../models/Enrollment');

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


// 👇 NEW ROUTE ADDED HERE: Verify Signature & Auto-Lock Seat
router.post('/verify-payment', authMiddleware, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      library_id,
      seat_number
    } = req.body;

    const library = await Library.findById(library_id);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    const rzpSecret = library.payment_settings?.razorpay_key_secret;
    if (!rzpSecret) {
      return res.status(400).json({ error: 'Payment gateway configuration missing.' });
    }

    // 1. Generate the HMAC SHA256 Signature to compare against Razorpay's
    const generatedSignature = crypto
      .createHmac('sha256', rzpSecret)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    // 2. Cryptographic check
    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed. Potential tampering detected.' });
    }

    // 3. Prevent Race Conditions (Check if someone literally just booked it)
    const existingBooking = await Enrollment.findOne({
      library_id,
      seat_number,
      status: { $in: ['Active', 'Pending'] }
    });

    if (existingBooking) {
      return res.status(400).json({ error: 'Seat was just taken! Please contact the library for a refund.' });
    }

    // 4. Auto-Approve & Lock the Seat!
    const today = new Date();
    // Set expiry to the exact last minute of the current month
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);

    const currentUserId = req.user.id || req.user._id;
    const newEnrollment = new Enrollment({
      student_id: currentUserId,
      library_id,
      seat_number,
      status: 'Active',
      payment_method: 'Online',
      payment_id: razorpay_payment_id,
      start_date: today, // 👈 Fix: Added start date
      end_date: endOfMonth // 👈 Fix: Added end date
    });

    await newEnrollment.save();

    await newEnrollment.save();

    // 5. Increment Library Occupancy
    library.occupied_seats += 1;
    await library.save();

    res.status(200).json({ 
      success: true, 
      message: 'Payment verified! Seat securely locked.' 
    });

  } catch (error) {
    console.error("Signature Verification Error:", error);
    res.status(500).json({ error: 'Server error during payment verification.' });
  }
});

module.exports = router;