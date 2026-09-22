const mongoose = require('mongoose');

const webhookEventSchema = new mongoose.Schema({
  event_id: { type: String, required: true, unique: true },
  event_type: { type: String },
  processed_at: { type: Date, default: Date.now, expires: 2592000 } // Auto-deletes after 30 days (in seconds)
});

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);