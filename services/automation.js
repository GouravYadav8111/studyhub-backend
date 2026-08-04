const cron = require("node-cron");
const Enrollment = require("../models/Enrollment");
const Library = require("../models/Library");
const Notification = require("../models/Notification");

// We wrap it in a function so we can pass the Socket.io instance from server.js
const startCronJobs = (io) => {
  console.log("⏰ Automation Engine Started: Background jobs are armed.");

  // Runs every day at 8:00 AM
  cron.schedule("0 8 * * *", async () => {
    console.log("🔄 Running daily subscription check...");

    try {
      const now = new Date();

      // Calculate the time range for exactly 2 days from now
      const twoDaysFromNowStart = new Date(now);
      twoDaysFromNowStart.setDate(now.getDate() + 2);
      twoDaysFromNowStart.setHours(0, 0, 0, 0);

      const twoDaysFromNowEnd = new Date(now);
      twoDaysFromNowEnd.setDate(now.getDate() + 2);
      twoDaysFromNowEnd.setHours(23, 59, 59, 999);

      /* ========================================================
         1. THE 2-DAY WARNING NOTIFICATIONS
         ======================================================== */
      const expiringSoon = await Enrollment.find({
        status: "Active",
        expires_at: { $gte: twoDaysFromNowStart, $lte: twoDaysFromNowEnd },
      })
        .populate("student_id")
        .populate("library_id");

      for (const enrollment of expiringSoon) {
        // Notify Student
        const studentNotif = new Notification({
          user_id: enrollment.student_id._id,
          type: "warning",
          title: "Seat Expiring Soon! ⏳",
          message: `Your ${enrollment.plan_type} pass for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} expires in 2 days. Renew at the desk to keep your seat!`,
        });
        await studentNotif.save();

        // Notify Library Owner
        const ownerNotif = new Notification({
          user_id: enrollment.library_id.owner_id,
          type: "info",
          title: "Upcoming Renewal 💰",
          message: `Seat #${enrollment.seat_number} (${enrollment.student_id.name}) expires in 2 days. Be ready to collect renewal fees.`,
        });
        await ownerNotif.save();

        // Live Socket Pings
        if (io) {
          io.to(enrollment.student_id._id.toString()).emit(
            "new_notification",
            studentNotif,
          );
          io.to(enrollment.library_id.owner_id.toString()).emit(
            "new_notification",
            ownerNotif,
          );
        }
      }

      /* ========================================================
         2. SAME-DAY AUTO-EXPIRY (EVICTION)
         ======================================================== */
      const expiredEnrollments = await Enrollment.find({
        status: "Active",
        expires_at: { $lte: now },
      })
        .populate("student_id")
        .populate("library_id");

      for (const enrollment of expiredEnrollments) {
        // Update status to Completed
        enrollment.status = "Completed";
        await enrollment.save();

        // Free up the physical seat in the library
        await Library.findByIdAndUpdate(enrollment.library_id._id, {
          $inc: { occupied_seats: -1 },
        });

        // Notify Student
        const studentExpiredNotif = new Notification({
          user_id: enrollment.student_id._id,
          type: "error",
          title: "Subscription Ended 🛑",
          message: `Your time for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} has ended. Your seat is now open to the public.`,
        });
        await studentExpiredNotif.save();

        // Notify Owner
        const ownerExpiredNotif = new Notification({
          user_id: enrollment.library_id.owner_id,
          type: "warning",
          title: "Seat Freed Up 🪑",
          message: `Seat #${enrollment.seat_number} has automatically expired and is available for new students to book.`,
        });
        await ownerExpiredNotif.save();

        // Live Socket Pings
        if (io) {
          io.to(enrollment.student_id._id.toString()).emit(
            "new_notification",
            studentExpiredNotif,
          );
          io.to(enrollment.library_id.owner_id.toString()).emit(
            "new_notification",
            ownerExpiredNotif,
          );
        }
      }

      console.log(
        `✅ Daily Check Complete: Warned ${expiringSoon.length} | Expired ${expiredEnrollments.length}`,
      );
    } catch (error) {
      console.error("❌ Automation Error:", error);
    }
  });
};

// 👇 FIX: Exported as an object to match the destructuring in server.js
module.exports = { startAutomation: startCronJobs };
