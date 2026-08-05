const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  // 👇 NEW: Added the phone number field
  phone: { type: String, default: "" },

  // 👇 ENFORCED ROLES: This guarantees the database accepts the exact spelling of our roles
  role: {
    type: String,
    enum: ["Student", "LibraryOwner", "SuperAdmin"],
    default: "Student",
  },
  favorite_libraries: [
    { type: mongoose.Schema.Types.ObjectId, ref: "Library" },
  ],

  // 👇 NEW: Store their active study tasks
  todos: [{ text: String, completed: { type: Boolean, default: false } }],

  // 👇 NEW: Store their daily study time (Digital Wellbeing tracking)
  daily_study_time: [
    {
      date: { type: String, required: true }, // Format: "YYYY-MM-DD"
      seconds: { type: Number, default: 0 },
    },
  ],
});

module.exports = mongoose.model("User", userSchema);
