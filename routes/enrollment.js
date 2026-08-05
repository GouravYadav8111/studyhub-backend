const express = require("express");
const Enrollment = require("../models/Enrollment");
const Library = require("../models/Library");
const Notification = require("../models/Notification");
const authMiddleware = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");
const nodemailer = require("nodemailer");
const sendPushNotification = require("../utils/sendPushNotification");

const router = express.Router();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- 1. STUDENT: REQUEST SPECIFIC SEAT ---
// 🔒 Secured: Only Students
router.post(
  "/",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      // 👇 NEW: Extract plan_type from the request body
      const { library_id, seat_number, plan_type } = req.body;

      if (!seat_number)
        return res
          .status(400)
          .json({ message: "Please select a specific seat from the map." });

      const library = await Library.findById(library_id);
      if (!library)
        return res.status(404).json({ message: "Library not found." });

      // Prevent booking blocked seats
      if (
        library.blocked_seats &&
        library.blocked_seats.includes(seat_number)
      ) {
        return res.status(400).json({
          message: `Seat ${seat_number} is currently under maintenance.`,
        });
      }

      // Check if student already has an active request anywhere
      const existingRequest = await Enrollment.findOne({
        student_id: req.user.id,
        library_id,
        status: { $ne: "Completed" },
      });
      if (existingRequest)
        return res
          .status(400)
          .json({ message: "You already have an active request here." });

      // Check if this exact seat was just snatched by someone else
      const seatTaken = await Enrollment.findOne({
        library_id,
        seat_number,
        status: { $in: ["Pending", "Active"] },
      });
      if (seatTaken)
        return res.status(400).json({
          message: `Seat ${seat_number} was just booked by someone else!`,
        });

      // 👇 NEW: Save the requested plan_type (daily or monthly) to the database
      const newEnrollment = new Enrollment({
        student_id: req.user.id,
        library_id,
        seat_number,
        plan_type: plan_type || "monthly", // fallback to monthly just in case
      });
      await newEnrollment.save();

      if (library.owner_id) {
        // 1. Save to Database forever
        const newNotification = new Notification({
          user_id: library.owner_id,
          type: "info",
          title: "New Seat Request!",
          message: `A student just requested Seat #${seat_number} at ${library.name} for a ${plan_type} pass.`,
        });
        await newNotification.save();

        // 2. Fire the Live Ping
        const io = req.app.get("io");
        if (io) {
          io.to(library.owner_id.toString()).emit("new_notification", {
            id: newNotification._id,
            type: newNotification.type,
            title: newNotification.title,
            message: newNotification.message,
            time: "Just now",
            isRead: false,
          });
        }

        // 3. 👇 NEW: Send Mobile/Desktop Native System Tray Push Notification!
        sendPushNotification(library.owner_id, {
          title: "New Seat Request! 🪑",
          message: `A student requested Seat #${seat_number} at ${library.name}.`,
          url: "/owner-dashboard",
        });
      }

      res.status(201).json({
        message: `Seat ${seat_number} requested successfully!`,
        enrollment: newEnrollment,
      });
    } catch (err) {
      // This will expose the exact crash reason to your frontend alert box
      console.error("🔥 CRASH REASON:", err);
      res.status(500).json({
        message: "Server crashed while booking.",
        error: err.message,
      });
    }
  },
);

// --- 2. STUDENT: GET MY REQUESTS ---
// 🔒 Secured: Only Students
router.get(
  "/my-requests",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const enrollments = await Enrollment.find({
        student_id: req.user.id,
      }).populate("library_id", "name location");
      res.json(enrollments);
    } catch (err) {
      res.status(500).json({ message: "Server error fetching your bookings." });
    }
  },
);

// --- 3. OWNER: VIEW PENDING REQUESTS ---
// 🔒 Secured: Only Library Owners
router.get(
  "/owner-requests",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const ownerLibraries = await Library.find({ owner_id: req.user.id });
      const libraryIds = ownerLibraries.map((lib) => lib._id);

      const requests = await Enrollment.find({
        library_id: { $in: libraryIds },
      })
        .populate("student_id", "name email")
        .populate("library_id", "name");
      res.json(requests);
    } catch (err) {
      res.status(500).json({ message: "Server error fetching requests." });
    }
  },
);

// --- 4. OWNER: APPROVE OR REJECT A SEAT ---
// 🔒 Secured: Only Library Owners
router.put(
  "/:id/status",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const { status } = req.body;

      const enrollment = await Enrollment.findById(req.params.id)
        .populate("student_id", "name email")
        .populate("library_id", "name location");

      if (!enrollment)
        return res.status(404).json({ message: "Request not found." });

      let expiresAt = null;

      if (status === "Active" && enrollment.status !== "Active") {
        await Library.findByIdAndUpdate(enrollment.library_id._id, {
          $inc: { occupied_seats: 1 },
        });

        // 👇 FIXED: CLOCK STARTS NOW - Set explicitly as start_date and end_date
        const now = new Date();
        expiresAt = new Date();
        if (enrollment.plan_type === "daily") {
          expiresAt.setDate(now.getDate() + 1); // Add 24 hours
        } else {
          expiresAt.setDate(now.getDate() + 30); // Add 30 days for monthly
        }

        // Save using the exact field names your frontend Fee Table is looking for
        enrollment.start_date = now;
        enrollment.end_date = expiresAt;
        enrollment.expires_at = expiresAt; // Kept as fallback
        
        // If they are manually approved without an online transaction, mark it as Cash
        if (!enrollment.payment_method) {
          enrollment.payment_method = 'Cash';
        }

        const dateString = expiresAt.toLocaleDateString("en-IN", {
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: enrollment.student_id.email,
          subject: "🎉 Your Library Seat is Approved!",
          text: `Hello ${enrollment.student_id.name},\n\nYour seat request at ${enrollment.library_id.name} (${enrollment.library_id.location}) has been officially approved.\n\nYour ${enrollment.plan_type} pass is valid until: ${dateString}.\n\nBest,\nStudyHub Team`,
        };

        transporter
          .sendMail(mailOptions)
          .catch((err) => console.error("Email failed:", err));
      } else if (status === "Rejected" && enrollment.status === "Active") {
        await Library.findByIdAndUpdate(enrollment.library_id._id, {
          $inc: { occupied_seats: -1 },
        });
      }

      enrollment.status = status;
      await enrollment.save();

      // REVERSE PING - NOTIFY THE STUDENT
      const notifType = status === "Active" ? "success" : "warning";
      const notifTitle =
        status === "Active" ? "Seat Approved! 🎉" : "Seat Rejected ❌";

      let notifMessage = "";
      if (status === "Active") {
        const dateStr = expiresAt.toLocaleDateString("en-IN", {
          month: "short",
          day: "numeric",
        });
        notifMessage = `Your request for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} is approved. Valid until ${dateStr}!`;
      } else {
        notifMessage = `Your request for Seat #${enrollment.seat_number} at ${enrollment.library_id.name} was rejected.`;
      }

      // 1. Save to Database forever
      const studentNotification = new Notification({
        user_id: enrollment.student_id._id,
        type: notifType,
        title: notifTitle,
        message: notifMessage,
      });
      await studentNotification.save();

      // 2. Fire the Live Ping to the Student
      const io = req.app.get("io");
      if (io) {
        io.to(enrollment.student_id._id.toString()).emit("new_notification", {
          id: studentNotification._id,
          type: studentNotification.type,
          title: studentNotification.title,
          message: studentNotification.message,
          time: "Just now",
          isRead: false,
        });
      }

      // 3. Send Mobile/Desktop Native System Tray Push Notification!
      sendPushNotification(enrollment.student_id._id, {
        title: status === "Active" ? "Seat Approved! 🎉" : "Seat Rejected ❌",
        message: notifMessage,
        url: "/student-dashboard",
      });

      res.json({ message: `Seat request marked as ${status}`, enrollment });
    } catch (err) {
      res.status(500).json({ message: "Server error updating status." });
    }
  }
);

// --- 5. STUDENT: CANCEL OR CHECKOUT ---
// 🔒 Secured: Only Students
router.delete(
  "/:id",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const enrollment = await Enrollment.findById(req.params.id);
      if (!enrollment)
        return res.status(404).json({ message: "Booking not found." });

      // LEVEL 3 SECURITY CHECK
      if (enrollment.student_id.toString() !== req.user.id) {
        return res
          .status(403)
          .json({ message: "Not authorized to cancel this booking." });
      }

      if (enrollment.status === "Active") {
        await Library.findByIdAndUpdate(enrollment.library_id, {
          $inc: { occupied_seats: -1 },
        });
      }

      await Enrollment.findByIdAndDelete(req.params.id);

      res.json({ message: "Booking successfully canceled and seat freed up." });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Server error while canceling booking." });
    }
  },
);

module.exports = router;
