const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const Library = require("../models/Library");
const Enrollment = require("../models/Enrollment");
const Notification = require("../models/Notification"); // 👈 Moved import to the top
const authMiddleware = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// =======================================================
// 🔔 NOTIFICATION ROUTES (MUST BE ABOVE THE WILDCARD `/:id`)
// =======================================================

// --- 1. GET ALL NOTIFICATIONS FOR A USER ---
router.get("/notifications", authMiddleware, async (req, res) => {
  try {
    const notifications = await Notification.find({
      user_id: req.user.id,
    }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// --- 2. MARK ALL NOTIFICATIONS AS READ ---
router.put("/notifications/mark-read", authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { user_id: req.user.id, isRead: false },
      { $set: { isRead: true } },
    );
    res.json({ success: true, message: "All caught up!" });
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// --- 3. DELETE A SPECIFIC NOTIFICATION ---
router.delete("/notifications/:id", authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification)
      return res.status(404).json({ message: "Notification not found" });

    // Ensure they can only delete their own
    if (notification.user_id.toString() !== req.user.id) {
      return res
        .status(401)
        .json({ message: "Not authorized to delete this notification" });
    }

    await Notification.findByIdAndDelete(req.params.id);
    res.json({ message: "Notification permanently deleted" });
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// --- 4. CLEAR ALL NOTIFICATIONS ---
router.delete("/notifications", authMiddleware, async (req, res) => {
  try {
    await Notification.deleteMany({ user_id: req.user.id });
    res.json({ message: "All notifications successfully cleared" });
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// =======================================================
// 👤 USER & ADMIN ROUTES
// =======================================================

// --- GET ALL USERS (SuperAdmin Only) ---
router.get(
  "/",
  authMiddleware,
  authorizeRoles("SuperAdmin"),
  async (req, res) => {
    try {
      const users = await User.find().select("-password");
      res.json(users);
    } catch (err) {
      res.status(500).json({ message: "Server error fetching users." });
    }
  },
);

// --- CASCADING DELETE USER (SuperAdmin Only) ---
// ⚠️ (This is the route that was previously blocking the notifications)
router.delete(
  "/:id",
  authMiddleware,
  authorizeRoles("SuperAdmin"),
  async (req, res) => {
    try {
      const userToDelete = await User.findById(req.params.id);
      if (!userToDelete)
        return res.status(404).json({ message: "User not found." });

      if (userToDelete.role === "LibraryOwner") {
        const libraries = await Library.find({ owner_id: userToDelete._id });
        for (let lib of libraries) {
          await Enrollment.deleteMany({ library_id: lib._id });
          await Library.findByIdAndDelete(lib._id);
        }
      } else if (userToDelete.role === "Student") {
        await Enrollment.deleteMany({ student_id: userToDelete._id });
      }

      await User.findByIdAndDelete(req.params.id);
      res.json({ message: "User and all associated data completely purged." });
    } catch (err) {
      res.status(500).json({ message: "Server error deleting user." });
    }
  },
);

// --- STUDENT: TOGGLE FAVORITE LIBRARY ---
router.post(
  "/favorites/:libraryId",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      const libraryId = req.params.libraryId;

      const isFavorited = user.favorite_libraries.some(
        (id) => id.toString() === libraryId,
      );
      if (isFavorited) {
        user.favorite_libraries = user.favorite_libraries.filter(
          (id) => id.toString() !== libraryId,
        );
      } else {
        user.favorite_libraries.push(libraryId);
      }

      await user.save();
      res.json({
        message: isFavorited ? "Removed from favorites" : "Added to favorites",
        favorites: user.favorite_libraries,
      });
    } catch (err) {
      res.status(500).json({ message: "Server error updating favorites." });
    }
  },
);

// --- STUDENT: GET FAVORITES ---
router.get(
  "/favorites",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      res.json(user.favorite_libraries || []);
    } catch (err) {
      res.status(500).json({ message: "Server error fetching favorites." });
    }
  },
);

// --- UPDATE USER PROFILE ---
router.put("/profile", authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ message: "User not found." });

    // 1. 🔒 Security Check: Verify Current Password
    if (!currentPassword) {
      return res
        .status(400)
        .json({ message: "Current password is required to save changes." });
    }
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res
        .status(400)
        .json({ message: "Incorrect current password. Changes reverted." });
    }

    // 2. Update Standard Fields
    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();

    // 3. Update Password (if provided)
    if (newPassword) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    // 4. Handle Email Change & Re-verification
    let emailChanged = false;
    const normalizedEmail = email ? email.trim().toLowerCase() : null;

    if (normalizedEmail && normalizedEmail !== user.email) {
      // Check if the new email is already taken by someone else
      const emailExists = await User.findOne({ email: normalizedEmail });
      if (emailExists) {
        return res
          .status(400)
          .json({
            message: "This email is already in use by another account.",
          });
      }

      user.email = normalizedEmail;
      user.isVerified = false; // Lock the account immediately

      // Generate new token
      const verificationToken = crypto.randomBytes(32).toString("hex");
      user.verificationToken = crypto
        .createHash("sha256")
        .update(verificationToken)
        .digest("hex");
      emailChanged = true;

      // Fire the verification email to the NEW email address
      const verifyUrl = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/auth/verify-email/${verificationToken}`;
      const scriptUrl =
        "https://script.google.com/macros/s/AKfycbynkKetyXGGRcwgIG6gN2_SYi-nuohtgAqggZMNEeHzYXu6SYjPTxLHgVyvlNpkaKRH/exec";

      fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secretKey: "StudyHub_API_Secure_2026",
          to: user.email,
          subject: "Verify your new StudySpace Email",
          htmlBody: `
            <h2>Hello ${user.name},</h2>
            <p>You recently updated your email address for your ${user.role} account.</p>
            <p>Please verify this new email address to unlock your account.</p>
            <a href="${verifyUrl}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; margin-top: 15px;">Verify New Email</a>
            <p style="margin-top: 25px; font-size: 12px; color: #666;">If you didn't request this change, please contact support immediately.</p>
          `,
        }),
      }).catch((err) => console.error("Background Email Error:", err));
    }

    await user.save();

    // 5. Send appropriate response to the frontend
    if (emailChanged) {
      return res.json({
        requiresVerification: true,
        message:
          "Email updated successfully. Please check your inbox to verify.",
      });
    }

    res.json({ message: "Profile updated successfully!" });
  } catch (err) {
    console.error("Profile Update Error:", err);
    res.status(500).json({ message: "Server error updating profile." });
  }
});

// --- STUDENT: GET & UPDATE TO-DOS ---
router.get(
  "/todos",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      res.json(user.todos || []);
    } catch (err) {
      res.status(500).json({ message: "Error fetching todos" });
    }
  },
);

router.put(
  "/todos",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      user.todos = req.body.todos;
      await user.save();
      res.json(user.todos);
    } catch (err) {
      res.status(500).json({ message: "Error saving todos" });
    }
  },
);

// --- STUDENT: DIGITAL WELLBEING TIMER ---
router.get(
  "/study-time",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      res.json(user.daily_study_time || []);
    } catch (err) {
      res.status(500).json({ message: "Error fetching study time" });
    }
  },
);

router.post(
  "/study-time",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const { date, seconds } = req.body;
      const user = await User.findById(req.user.id);

      const existingDate = user.daily_study_time.find((d) => d.date === date);
      if (existingDate) {
        existingDate.seconds += Number(seconds);
      } else {
        user.daily_study_time.push({ date, seconds: Number(seconds) });
      }

      await user.save();
      res.json(user.daily_study_time);
    } catch (err) {
      res.status(500).json({ message: "Error saving study time" });
    }
  },
);

// --- SUPERADMIN: GLOBAL METRICS ---
router.get(
  "/admin/stats",
  authMiddleware,
  authorizeRoles("SuperAdmin"),
  async (req, res) => {
    try {
      const totalUsers = await User.countDocuments();
      const totalLibraries = await Library.countDocuments();

      const allLibraries = await Library.find();
      const globalTotalSeats = allLibraries.reduce(
        (acc, lib) => acc + lib.total_seats,
        0,
      );
      const globalOccupiedSeats = allLibraries.reduce(
        (acc, lib) => acc + lib.occupied_seats,
        0,
      );

      const activeSessions = await Enrollment.countDocuments({
        status: "Active",
      });

      res.json({
        totalUsers,
        totalLibraries,
        globalTotalSeats,
        globalOccupiedSeats,
        activeSessions,
      });
    } catch (err) {
      res.status(500).json({ message: "Error fetching global stats" });
    }
  },
);

module.exports = router;
