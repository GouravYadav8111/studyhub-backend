const cron = require("node-cron");
const Enrollment = require("../models/Enrollment");
const Library = require("../models/Library");
const Notification = require("../models/Notification");
const sendEmail = require("../utils/sendEmail"); // 👈 NEW: Import the email utility

const getDateRange = (daysToAdd) => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() + daysToAdd);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setDate(now.getDate() + daysToAdd);
  end.setHours(23, 59, 59, 999);

  return { start, end };
};

const startCronJobs = (io) => {
  console.log("⏰ Automation Engine Started: Background jobs are armed.");

  cron.schedule("0 8 * * *", async () => {
    console.log("🔄 Running daily automation checks...");

    try {
      const now = new Date();
      const { start: studentWarningStart, end: studentWarningEnd } = getDateRange(2);
      const { start: in3DaysStart, end: in3DaysEnd } = getDateRange(3);
      const { start: in1DayStart, end: in1DayEnd } = getDateRange(1);

      /* ========================================================
         1 & 2: STUDENT AUTOMATIONS (Unchanged)
         ======================================================== */
      const expiringSoon = await Enrollment.find({
        status: "Active",
        expires_at: { $gte: studentWarningStart, $lte: studentWarningEnd },
      }).populate("student_id").populate("library_id");

      const pendingNotifications = [];

      for (const enrollment of expiringSoon) {
        const studentNotif = new Notification({
          user_id: enrollment.student_id._id,
          type: "warning",
          title: "Seat Expiring Soon! ⏳",
          message: `Your ${enrollment.plan_type} pass for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} expires in 2 days.`,
        });
        
        const ownerNotif = new Notification({
          user_id: enrollment.library_id.owner_id,
          type: "info",
          title: "Upcoming Renewal 💰",
          message: `Seat #${enrollment.seat_number} (${enrollment.student_id.name}) expires in 2 days.`,
        });

        pendingNotifications.push(studentNotif, ownerNotif);

        if (io) {
          io.to(enrollment.student_id._id.toString()).emit("new_notification", studentNotif);
          io.to(enrollment.library_id.owner_id.toString()).emit("new_notification", ownerNotif);
        }
      }

      const expiredEnrollments = await Enrollment.find({
        status: "Active",
        expires_at: { $lte: now },
      }).populate("student_id").populate("library_id");

      for (const enrollment of expiredEnrollments) {
        enrollment.status = "Completed";
        await enrollment.save();

        await Library.findByIdAndUpdate(enrollment.library_id._id, {
          $inc: { occupied_seats: -1 },
        });

        const studentExpiredNotif = new Notification({
          user_id: enrollment.student_id._id,
          type: "error",
          title: "Subscription Ended 🛑",
          message: `Your time for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} has ended.`,
        });
        
        const ownerExpiredNotif = new Notification({
          user_id: enrollment.library_id.owner_id,
          type: "warning",
          title: "Seat Freed Up 🪑",
          message: `Seat #${enrollment.seat_number} has automatically expired.`,
        });

        pendingNotifications.push(studentExpiredNotif, ownerExpiredNotif);

        if (io) {
          io.to(enrollment.student_id._id.toString()).emit("new_notification", studentExpiredNotif);
          io.to(enrollment.library_id.owner_id.toString()).emit("new_notification", ownerExpiredNotif);
        }
      }

      /* ========================================================
         3. LIBRARY OWNERS: 3-DAY & 1-DAY EMAIL WARNINGS
         ======================================================== */
      const librariesToWarn = await Library.find({
        "subscription.status": "active",
        $or: [
          { "subscription.current_period_end": { $gte: in3DaysStart, $lte: in3DaysEnd } },
          { "subscription.current_period_end": { $gte: in1DayStart, $lte: in1DayEnd } }
        ]
      }).populate("owner_id"); // 👈 POPULATE added to fetch email

      for (const lib of librariesToWarn) {
        const endDate = new Date(lib.subscription.current_period_end);
        const isOneDay = endDate >= in1DayStart && endDate <= in1DayEnd;
        const urgency = isOneDay ? "Tomorrow" : "in 3 Days";

        const title = `Subscription Expiring ${urgency} ⚠️`;
        const message = `Your SaaS subscription for ${lib.name} expires ${urgency}. Please ensure your payment method is valid to avoid losing your spot on the student map.`;

        const ownerReminder = new Notification({
          user_id: lib.owner_id._id,
          type: "warning",
          title: title,
          message: message,
        });

        pendingNotifications.push(ownerReminder);

        if (io) {
          io.to(lib.owner_id._id.toString()).emit("new_notification", ownerReminder);
        }

        // 👈 NEW: Fire the professional email!
        if (lib.owner_id.email) {
          await sendEmail({
            email: lib.owner_id.email,
            subject: `StudySpace: ${title}`,
            message: `<h3 style="color: #1e293b; margin-top: 0;">Hello ${lib.owner_id.name || 'Partner'},</h3>
                      <p style="font-size: 16px; line-height: 1.5;">${message}</p>
                      <p style="font-size: 16px; line-height: 1.5;">Log in to your Dashboard to manage your billing settings.</p>`
          });
        }
      }

      /* ========================================================
         4. LIBRARY OWNERS: LOCKOUT & EMAIL NOTIFICATION
         ======================================================== */
      const expiredLibraries = await Library.find({
        "subscription.status": "grace_period",
        "subscription.grace_period_end": { $lte: now }
      }).populate("owner_id"); // 👈 POPULATE added to fetch email

      for (const lib of expiredLibraries) {
        lib.subscription.status = "past_due";
        lib.status = "Rejected"; 
        await lib.save();

        const title = "Library Hidden 🛑";
        const message = `The 24-hour grace period for ${lib.name} has ended. Your library is no longer visible to students. Renew immediately to restore access.`;

        const lockNotif = new Notification({
          user_id: lib.owner_id._id,
          type: "error",
          title: title,
          message: message,
        });

        pendingNotifications.push(lockNotif);

        if (io) {
          io.to(lib.owner_id._id.toString()).emit("new_notification", lockNotif);
        }

        // 👈 NEW: Fire the Lockout Email
        if (lib.owner_id.email) {
          await sendEmail({
            email: lib.owner_id.email,
            subject: `StudySpace: ${title}`,
            message: `<h3 style="color: #e11d48; margin-top: 0;">Action Required: ${lib.name} is Offline</h3>
                      <p style="font-size: 16px; line-height: 1.5;">${message}</p>
                      <a href="https://your-domain.com/login" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">Renew Subscription Now</a>`
          });
        }
      }

      if (pendingNotifications.length > 0) {
        await Notification.insertMany(pendingNotifications);
      }

      console.log(
        `✅ Daily Check Complete: Warned ${expiringSoon.length} students | Evicted ${expiredEnrollments.length} | Emailed ${librariesToWarn.length} owners | Locked ${expiredLibraries.length} libraries`
      );
    } catch (error) {
      console.error("❌ Automation Error:", error);
    }
  });
};

module.exports = { startAutomation: startCronJobs };