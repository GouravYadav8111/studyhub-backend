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
    // 👇 NEW: Store the specific seat number
    seat_number: { type: Number, required: true },
    status: {
      type: String,
      // 👇 ADDED 'Completed' so the auto-eviction cron job doesn't crash
      enum: ["Pending", "Active", "Rejected", "Completed"],
      default: "Pending",
    },
    // 👇 ADDED: Missing payment and date fields so Mongoose saves them
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

    // 👇 NEW FIELDS FOR SUBSCRIPTION ENGINE
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

// 👇 NEW: Compound Index for lightning-fast student-library lookups
enrollmentSchema.index({ student_id: 1, library_id: 1 });
// (You can also index just the library for when the owner fetches their requests)
enrollmentSchema.index({ library_id: 1, status: 1 });

module.exports = mongoose.model("Enrollment", enrollmentSchema);
