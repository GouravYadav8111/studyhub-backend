const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  library_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Library', 
    required: true 
  },
  // Optional because Walk-In students might not have a registered app account
  student_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User',
    default: null
  },
  student_name: { type: String, required: true },
  student_phone: { type: String, required: true },
  seat_number: { type: Number, required: true },
  
  // Financials
  base_monthly_rate: { type: Number, required: true }, 
  amount_paid: { type: Number, required: true }, // The final calculated/locked total
  prorated_days: { type: Number, required: true },
  
  // Payment Details
  payment_method: { 
    type: String, 
    enum: ['Razorpay', 'Cash'], 
    required: true 
  },
  razorpay_order_id: { type: String, default: null }, 
  razorpay_payment_id: { type: String, default: null }, 
  
  status: { 
    type: String, 
    enum: ['Pending', 'Completed', 'Failed', 'Refunded'], 
    default: 'Pending' 
  },
  
  // Unique Invoice tracking
  invoice_number: { type: String, unique: true, required: true },
  
  // Lease Term this payment covers
  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },

}, { timestamps: true });

// Auto-generate a unique invoice number before saving
transactionSchema.pre('validate', function(next) {
  if (!this.invoice_number) {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    this.invoice_number = `INV-${datePart}-${randomPart}`;
  }
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);