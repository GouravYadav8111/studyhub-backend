const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const mongoose = require("mongoose"); // 👈 NEW: Added to support Transactions
const Library = require("../models/Library");
const PaymentLog = require("../models/PaymentLog");

// 🚨 CRITICAL: Razorpay requires the RAW unparsed body to verify the cryptographic signature. 
// Do not use express.json() for this specific route!
router.post("/razorpay", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET; 

    // 1. Cryptographic Signature Verification
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(req.body)
      .digest("hex");

    if (expectedSignature !== signature) {
      return res.status(400).json({ success: false, message: "🚨 Hacker attempt blocked: Invalid signature" });
    }

    // Parse the body now that it is mathematically proven to be from Razorpay
    const event = JSON.parse(req.body);
    const eventId = req.headers["x-razorpay-event-id"];

    // 2. Idempotency Check: Did a network glitch send this ping twice?
    const existingLog = await PaymentLog.findOne({ webhook_event_id: eventId });
    if (existingLog) {
      return res.status(200).json({ success: true, message: "Event already processed." });
    }

    // 3. Find the associated Library
    const subscriptionEntity = event.payload.subscription.entity;
    const subId = subscriptionEntity.id;
    const library = await Library.findOne({ "subscription.razorpay_subscription_id": subId });

    if (!library) {
      return res.status(200).send("Library not found in system, ignoring.");
    }

    // 4. Handle the specific lifecycle events WITH A TRANSACTION
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      if (event.event === "subscription.charged") {
        // Payment Successful!
        const paymentEntity = event.payload.payment.entity;
        
        // Razorpay uses UNIX timestamps (seconds). Convert to JavaScript Date (milliseconds)
        const currentEnd = new Date(subscriptionEntity.current_end * 1000);
        const graceEnd = new Date(currentEnd.getTime() + (24 * 60 * 60 * 1000)); 

        library.subscription.status = "active";
        library.subscription.current_period_end = currentEnd;
        library.subscription.grace_period_end = graceEnd;
        library.status = "Approved"; // Keeps your map functioning flawlessly

        // Log the transaction securely WITHIN the session
        // Note: .create() inside a transaction requires passing an array of documents
        await PaymentLog.create([{
          library_id: library._id,
          owner_id: library.owner_id,
          razorpay_payment_id: paymentEntity.id,
          razorpay_subscription_id: subId,
          amount: paymentEntity.amount / 100, // Convert paise back to INR
          event_type: event.event,
          webhook_event_id: eventId
        }], { session });
      } 
      else if (event.event === "subscription.pending") {
        // Razorpay tried to charge them, but the card failed or lacked funds
        library.subscription.status = "grace_period";
      }
      else if (event.event === "subscription.halted" || event.event === "subscription.cancelled") {
        // Grace period expired or owner manually cancelled
        library.subscription.status = "past_due";
        library.status = "Rejected"; // Instantly hides it from the student map
      }

      // Save the library WITHIN the session
      await library.save({ session });
      
      // Commit both actions to the database simultaneously
      await session.commitTransaction();
      res.status(200).json({ success: true });

    } catch (transactionError) {
      // If anything fails, undo everything to prevent data mismatch
      await session.abortTransaction();
      throw transactionError; // Pass to the outer catch block to send 500 error
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("Webhook Processing Error:", error);
    res.status(500).send("Webhook Error");
  }
});

module.exports = router;