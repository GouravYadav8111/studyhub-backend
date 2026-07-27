const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  library_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Library', required: true },
  // 👇 NEW: Store the specific seat number
  seat_number: { type: Number, required: true },
  status: { 
    type: String, 
    enum: ['Pending', 'Active', 'Rejected'], 
    default: 'Pending' 
  },
  // 👇 ADDED: Missing payment and date fields so Mongoose saves them
  payment_method: { 
    type: String, 
    enum: ['Cash', 'Online'],
    default: 'Cash'
  },
  payment_id: { 
    type: String 
  },
  start_date: { 
    type: Date 
  },
  end_date: { 
    type: Date 
  }
}, { timestamps: true });

module.exports = mongoose.model('Enrollment', enrollmentSchema);