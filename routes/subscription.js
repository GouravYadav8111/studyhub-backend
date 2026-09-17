const express = require("express");
const router = express.Router();
const Razorpay = require("razorpay");
const User = require("../models/User");
const Library = require("../models/Library");
const { protect, authorizeRoles } = require("../middleware/authMiddleware"); // Adjust import based on your auth middleware

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// @route   POST /api/subscriptions/create
// @desc    Generate a dynamic Razorpay subscription for a library
// @access  Private (LibraryOwner only)
router.post("/create", protect, authorizeRoles("LibraryOwner"), async (req, res) => {
  try {
    const { libraryId, planType } = req.body; // planType should be '1_month' or '3_months'

    // 1. Validate Library & Ownership
    const library = await Library.findById(libraryId);
    if (!library) {
      return res.status(404).json({ message: "Library not found." });
    }
    if (String(library.owner_id) !== String(req.user.id)) {
      return res.status(403).json({ message: "Unauthorized to modify this library." });
    }

    // 2. Fetch User & Ensure Razorpay Customer Exists
    // We select('+razorpay_customer_id') because we hid it in the schema for security
    const user = await User.findById(req.user.id).select('+razorpay_customer_id');
    
    if (!user.razorpay_customer_id) {
      const customer = await razorpay.customers.create({
        name: user.name,
        email: user.email,
        contact: user.phone || undefined,
        notes: { userId: String(user._id) }
      });
      user.razorpay_customer_id = customer.id;
      await user.save();
    }

    // 3. Dynamic Pricing Calculation (Strictly Server-Side)
    const SEAT_RATE = 10; // ₹10 per seat
    const amountInRupees = library.total_seats * SEAT_RATE;
    const amountInPaise = amountInRupees * 100;
    
    // Determine billing interval based on plan selection
    const billingInterval = planType === "3_months" ? 3 : 1;

    // 4. Create a Dynamic Plan in Razorpay
    const plan = await razorpay.plans.create({
      period: "monthly",
      interval: billingInterval,
      item: {
        name: `StudySpace Subscription - ${library.name}`,
        amount: amountInPaise,
        currency: "INR",
        description: `${library.total_seats} seats at ₹${SEAT_RATE}/seat billed every ${billingInterval} month(s).`
      }
    });

    // 5. Create the Subscription
    const subscription = await razorpay.subscriptions.create({
      plan_id: plan.id,
      customer_id: user.razorpay_customer_id,
      total_count: 120, // Sets maximum billing cycles (10 years) before it auto-expires
      customer_notify: 1, // Let Razorpay send the automated emails
    });

    // 6. Update the Library Database
    library.subscription.razorpay_subscription_id = subscription.id;
    library.subscription.status = 'created';
    library.subscription.plan_type = planType;
    await library.save();

    // 7. Send the subscription ID back to the frontend to launch the payment modal
    res.status(200).json({
      success: true,
      subscription_id: subscription.id,
      amount: amountInRupees
    });

  } catch (error) {
    console.error("Subscription Creation Error:", error);
    res.status(500).json({ 
      message: "Failed to generate subscription.", 
      error: error.message 
    });
  }
});

module.exports = router;