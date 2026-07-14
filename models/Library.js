const mongoose = require('mongoose');

const librarySchema = new mongoose.Schema({
  name: { type: String, required: true },
  total_seats: { type: Number, required: true },
  occupied_seats: { type: Number, default: 0 },
  location: { type: String, required: true },
  
  // 👈 NEW: Added description and amenities array
  description: { type: String, default: 'A quiet and focused place to study.' }, 
  amenities: { type: [String], default: [] }, 

  // 👇 NEW: Rating and Reviews system
  rating: { type: Number, default: 0 },
  reviews: [
    {
      student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      student_name: String,
      rating: { type: Number, required: true, min: 1, max: 5 },
      comment: String,
      date: { type: Date, default: Date.now }
    }
  ],
  
  
  owner_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' }
});

module.exports = mongoose.model('Library', librarySchema);