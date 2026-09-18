const mongoose = require("mongoose");

const enrollmentSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    library_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Library",
      required: true,
    },
    // 👇 FIX: Changed from Number to String so it accepts "A9", "B2", etc.
    seat_number: { type: String, required: true },
    status: {
      type: String,
      enum: ["Pending", "Active", "Rejected", "Completed"],
      default: "Pending",
    },
    payment_method: {
      type: String,
      enum: ["Cash", "Online"],
      default: "Cash",
    },
    payment_id: {
      type: String,
    },
    start_date: {
      type: Date,
    },
    end_date: {
      type: Date,
    },
    plan_type: {
      type: String,
      enum: ["daily", "monthly"],
      default: "monthly",
    },
    expires_at: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// --- DATABASE INDEXES FOR LIGHTNING-FAST QUERIES ---
// Optimizes the query checking if a student is already in a specific library
enrollmentSchema.index({ student_id: 1, library_id: 1 });

// Optimizes the dashboard queries fetching all active/pending students for a library
enrollmentSchema.index({ library_id: 1, status: 1 });

// 🚨 NEW: Optimizes checking if a specific seat is currently occupied during checkout/walk-in
enrollmentSchema.index({ library_id: 1, seat_number: 1, status: 1 });

module.exports = mongoose.model("Enrollment", enrollmentSchema);