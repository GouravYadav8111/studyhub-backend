const cron = require('node-cron');
const Enrollment = require('../models/Enrollment');
const Notification = require('../models/Notification');

// This function runs automatically every day at Midnight (00:00)
const startAutomation = () => {
  cron.schedule('0 0 * * *', async () => {
    console.log("🤖 [CRON] Waking up to check for expiring seats...");

    try {
      // 1. Get today's date, and the date exactly 3 days from now
      const today = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);

      // 2. Find all active bookings that expire in exactly 3 days
      // (Note: This assumes your Enrollment model has an `expires_at` or `valid_until` date field)
      const expiringBookings = await Enrollment.find({
        status: 'Active',
        expires_at: {
          $gte: new Date(threeDaysFromNow.setHours(0, 0, 0, 0)),
          $lte: new Date(threeDaysFromNow.setHours(23, 59, 59, 999))
        }
      }).populate('library_id');

      console.log(`🤖 [CRON] Found ${expiringBookings.length} seats expiring soon.`);

      // 3. Generate a notification for each user
      for (let booking of expiringBookings) {
        await Notification.create({
          user_id: booking.student_id,
          title: '⏳ Seat Expiring Soon!',
          message: `Your booking for Seat #${booking.seat_number} at ${booking.library_id.name} expires in 3 days. Please renew to keep your spot!`,
          type: 'warning'
        });
      }

      console.log("🤖 [CRON] Successfully sent expiration alerts.");
    } catch (error) {
      console.error("❌ [CRON] Error running automation:", error);
    }
  });
};

module.exports = { startAutomation };