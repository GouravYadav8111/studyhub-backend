const cron = require("node-cron");
const Enrollment = require("../models/Enrollment"); // Update with your actual path
const Notification = require("../models/Notification"); // Update with your actual path
// If you use an imported socket instance, require it here. 
// e.g., const { getIo } = require("../socket");

const startCronJobs = (io) => {
  // Runs every day at 8:00 AM server time
  cron.schedule("* * * * *", async () => {
    console.log("Running daily fee renewal check...");

    try {
      const today = new Date();
      
      // Calculate target dates
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(today.getDate() + 3);
      
      const oneDayFromNow = new Date();
      oneDayFromNow.setDate(today.getDate() + 1);

      // Helper function to get start and end of a specific day for safe DB querying
      const getDayRange = (date) => {
        const start = new Date(date.setHours(0, 0, 0, 0));
        const end = new Date(date.setHours(23, 59, 59, 999));
        return { start, end };
      };

      const threeDaysRange = getDayRange(threeDaysFromNow);
      const oneDayRange = getDayRange(oneDayFromNow);

      // 1. Find enrollments expiring in exactly 3 days
      const threeDayAlerts = await Enrollment.find({
        status: "Active",
        expiry_date: { $gte: threeDaysRange.start, $lte: threeDaysRange.end }
      }).populate("student_id library_id");

      // 2. Find enrollments expiring in exactly 1 day
      const oneDayAlerts = await Enrollment.find({
        status: "Active",
        expiry_date: { $gte: oneDayRange.start, $lte: oneDayRange.end }
      }).populate("student_id library_id");

      // 3. Process 3-Day Warnings
      for (const enrollment of threeDayAlerts) {
        await sendRenewalAlert(
          enrollment, 
          io, 
          "Upcoming Fee Renewal", 
          `Your seat at ${enrollment.library_id.name} expires in 3 days. Please renew soon to keep your desk.`
        );
      }

      // 4. Process 1-Day Urgent Warnings
      for (const enrollment of oneDayAlerts) {
        await sendRenewalAlert(
          enrollment, 
          io, 
          "Action Required: Seat Expiring Tomorrow", 
          `Your booking at ${enrollment.library_id.name} expires tomorrow! Renew now to avoid losing your seat.`
        );
      }

      console.log("Daily fee renewal check complete.");
    } catch (error) {
      console.error("Error in daily cron job:", error);
    }
  });
};

// Helper to save DB notification and emit socket event
const sendRenewalAlert = async (enrollment, io, title, message) => {
  const studentId = enrollment.student_id._id;

  // Save to database so it shows up in their notification drawer
  const newNotification = await Notification.create({
    user_id: studentId,
    title: title,
    message: message,
    type: "warning",
    isRead: false
  });

  // Emit live via WebSocket if they are currently online
  if (io) {
    // Assuming you join users to rooms based on their user ID when they connect
    io.to(studentId.toString()).emit("new_notification", newNotification);
  }
};

module.exports = startCronJobs;