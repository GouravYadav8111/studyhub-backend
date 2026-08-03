const mongoose = require("mongoose");

const librarySchema = new mongoose.Schema({
  name: { type: String, required: true },
  total_seats: { type: Number, required: true },
  occupied_seats: { type: Number, default: 0 },
  location: { type: String, required: true },

  // Add this field to store the 144-cell grid array:
  floor_plan: {
    type: Array,
    default: []
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
  description: { type: String, default: "A quiet and focused place to study." },
  amenities: { type: [String], default: [] },

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
    enum: ["Pending", "Approved", "Rejected"],
    default: "Pending",
  },

  // 👇 NEW: Pricing & Payment Configuration
  pricing: {
    monthly_rate: { type: Number, default: 1000 }, // Owner's base custom rate
  },
  payment_settings: {
    razorpay_key_id: { type: String, default: "" },
    razorpay_key_secret: { type: String, default: "" }, 
  },
  
}, { timestamps: true }); // 👈 We added timestamps: true right here!


// 👇 NEW: Database Indexing for lightning-fast queries
librarySchema.index({ name: 'text', location: 'text' });
librarySchema.index({ status: 1 });
librarySchema.index({ owner_id: 1 });


module.exports = mongoose.model("Library", librarySchema);
