const mongoose = require("mongoose");

const paymentLogSchema = new mongoose.Schema({
  library_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Library', 
    required: true,
    index: true
  },
  owner_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  razorpay_payment_id: { 
    type: String,
    sparse: true // Allows nulls, but ensures unique if present
  },
  razorpay_subscription_id: { 
    type: String,
    required: true,
    index: true
  },
  amount: { 
    type: Number, 
    required: true 
  },
  currency: { 
    type: String, 
    default: 'INR' 
  },
  event_type: { 
    type: String,
    required: true // e.g., 'subscription.charged', 'payment.failed'
  },
  webhook_event_id: {
    type: String,
    unique: true, // 🚨 CRITICAL: Prevents processing the exact same webhook twice
    required: true
  }
}, { timestamps: true });

module.exports = mongoose.model("PaymentLog", paymentLogSchema);