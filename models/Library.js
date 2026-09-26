const mongoose = require("mongoose");
const Razorpay = require('razorpay');

const librarySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    total_seats: { type: Number, required: true },
    occupied_seats: { type: Number, default: 0 },
    location: { type: String, required: true },

    // Add this field to store the 144-cell grid array:
    floor_plan: {
      type: Array,
      default: [],
    },

    // 👇 ADD THIS NEW FIELD
    blocked_seats: {
      type: [Number],
      default: [],
    },

    // 👇 NEW: The detailed tracking for fixed seats
    seat_allocations: [
      {
        seat_number: {
          type: Number,
          required: true,
        },
        student_name: {
          type: String,
          required: true,
        },
        student_phone: {
          type: String,
          required: true,
        },
        start_date: {
          type: Date,
          required: true,
          default: Date.now,
        },
        end_date: {
          type: Date,
          required: true,
        },
        booking_type: {
          type: String,
          enum: ["App", "Walk-In"],
          default: "Walk-In",
        },
      },
    ],

    // 👈 NEW: Added description and amenities array
    description: {
      type: String,
      default: "A quiet and focused place to study.",
    },
    amenities: { type: [String], default: [] },

    // 👇 NEW: Array of Cloudinary URLs for library photos
    images: { type: [String], default: [] },

    // 👇 NEW: Rating and Reviews system
    rating: { type: Number, default: 0 },
    reviews: [
      {
        student_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        student_name: String,
        rating: { type: Number, required: true, min: 1, max: 5 },
        comment: String,
        date: { type: Date, default: Date.now },
      },
    ],

    owner_id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected" , "Payment_Pending"],
      default: "Payment_Pending",
    },

    // 👇 NEW: Automated Subscription Tracking
    subscription: {
      razorpay_subscription_id: {
        type: String,
        default: null,
      },
      status: {
        type: String,
        enum: [
          "inactive", // No active plan
          "created", // Order generated, waiting for first payment
          "active", // Fully paid and running
          "grace_period", // Billing failed/ended, in the 24hr grace window
          "past_due", // Grace period failed, officially locked out
          "cancelled", // Owner manually cancelled
        ],
        default: "inactive",
      },
      plan_type: {
        type: String,
        enum: ["1_month", "3_months"],
        default: "1_month",
      },
      current_period_end: {
        type: Date,
        default: null,
      },
      // Handles the exact 1-day grace period requirement
      grace_period_end: {
        type: Date,
        default: null,
      },
    },

    // 👇 NEW: Pricing & Payment Configuration
    pricing: {
      monthly_rate: { type: Number, default: 1000 }, // Owner's base custom rate
    },
    payment_settings: {
      razorpay_key_id: { type: String, default: "" },
      razorpay_key_secret: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

// --- DATABASE INDEXES FOR LIGHTNING-FAST QUERIES ---
// Optimizes student search map queries
librarySchema.index({ name: "text", location: "text" });

// Optimizes the main dashboard queries (fetching libraries by approval status)
librarySchema.index({ status: 1 });

// Optimizes the multi-library fetching when an owner logs in
librarySchema.index({ owner_id: 1 });

// 🚨 NEW: Optimizes the Razorpay Webhook so it instantly finds the exact library to update
librarySchema.index({ "subscription.razorpay_subscription_id": 1 });

// 🚨 NEW: Optimizes your daily Cron Job that checks for expired grace periods
librarySchema.index({
  "subscription.status": 1,
  "subscription.grace_period_end": 1,
});


// 👇 NEW: Automated Billing Kill Switch (Crash-Proof Version)
// This runs automatically whenever Library.findByIdAndDelete() is called anywhere in your app
librarySchema.pre('findOneAndDelete', async function() { 
  // Notice we removed 'next' from the function parameters above!
  try {
    // Find the specific library document that is about to be deleted
    const libraryToDelete = await this.model.findOne(this.getQuery());
    
    // Check if it has an active AutoPay subscription
    if (libraryToDelete && libraryToDelete.subscription && libraryToDelete.subscription.razorpay_subscription_id) {
      
      const razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      });

      try {
        // Attempt to instantly cancel the mandate in Razorpay
        await razorpayInstance.subscriptions.cancel(libraryToDelete.subscription.razorpay_subscription_id);
        console.log(`✅ Safety Check: AutoPay Subscription ${libraryToDelete.subscription.razorpay_subscription_id} cancelled for deleted library.`);
      } catch (rzpError) {
        // 👇 FIX: If Razorpay throws a 400 error saying it's already cancelled, ignore it and proceed!
        if (rzpError.statusCode === 400 && rzpError.error?.description?.includes('cancelled')) {
          console.log(`⏩ Skipped Razorpay cancellation: Subscription was already cancelled.`);
        } else {
          console.error("⚠️ Razorpay cancellation failed (Network/API issue), but proceeding with deletion.");
        }
      }
    }
    
    // Modern Mongoose async hooks automatically proceed when they finish executing. 
    // We no longer need to call next() here, avoiding the TypeError!
  } catch (error) {
    console.error("Critical Error during library pre-delete phase:", error);
  }
});

module.exports = mongoose.model("Library", librarySchema);
