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

// Compound Index for lightning-fast student-library lookups
enrollmentSchema.index({ student_id: 1, library_id: 1 });
enrollmentSchema.index({ library_id: 1, status: 1 });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
