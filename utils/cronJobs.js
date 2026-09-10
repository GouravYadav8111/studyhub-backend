const express = require("express");
const router = express.Router();
const Enrollment = require("../models/Enrollment"); 
const Notification = require("../models/Notification"); 

const sendRenewalAlert = async (enrollment, io, title, message) => {
  const studentId = enrollment.student_id._id;

  const newNotification = await Notification.create({
    user_id: studentId,
    title: title,
    message: message,
    type: "warning",
    isRead: false
  });

  if (io) {
    io.to(studentId.toString()).emit("new_notification", newNotification);
  }
};

// NEW: API Endpoint to trigger the job externally
router.post("/daily-renewals", async (req, res) => {
  // Security Check: Ensure only your external cron service can run this
  if (req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized access" });
  }

  console.log("Running daily fee renewal check via external trigger...");

  try {
    // Grab the live Socket.io instance from the Express app
    const io = req.app.get("io"); 
    const today = new Date();

    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(today.getDate() + 3);

    const oneDayFromNow = new Date();
    oneDayFromNow.setDate(today.getDate() + 1);

    const getDayRange = (date) => {
      const start = new Date(date.setHours(0, 0, 0, 0));
      const end = new Date(date.setHours(23, 59, 59, 999));
      return { start, end };
    };

    const threeDaysRange = getDayRange(threeDaysFromNow);
    const oneDayRange = getDayRange(oneDayFromNow);

    const threeDayAlerts = await Enrollment.find({
      status: "Active",
      expiry_date: { $gte: threeDaysRange.start, $lte: threeDaysRange.end }
    }).populate("student_id library_id");

    const oneDayAlerts = await Enrollment.find({
      status: "Active",
      expiry_date: { $gte: oneDayRange.start, $lte: oneDayRange.end }
    }).populate("student_id library_id");

    for (const enrollment of threeDayAlerts) {
      await sendRenewalAlert(
        enrollment, 
        io, 
        "Upcoming Fee Renewal", 
        `Your seat at ${enrollment.library_id.name} expires in 3 days. Please renew soon to keep your desk.`
      );
    }

    for (const enrollment of oneDayAlerts) {
      await sendRenewalAlert(
        enrollment, 
        io, 
        "Action Required: Seat Expiring Tomorrow", 
        `Your booking at ${enrollment.library_id.name} expires tomorrow! Renew now to avoid losing your seat.`
      );
    }

    console.log("Daily fee renewal check complete.");
    res.status(200).json({ message: "Daily alerts processed successfully." });
  } catch (error) {
    console.error("Error in daily cron endpoint:", error);
    res.status(500).json({ error: "Internal server error processing alerts." });
  }
});

module.exports = router;