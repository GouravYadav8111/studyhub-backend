const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const crypto = require("crypto");

// Initialize Google Client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- 1. POST: Register a new user ---
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    const normalizedEmail = email.trim().toLowerCase();

    let user = await User.findOne({ email: normalizedEmail }).lean();
    if (user) {
      return res
        .status(400)
        .json({ message: "User already exists with this email." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "Student",
      phone: phone ? phone.trim() : "",
    });

    await newUser.save();

    const payload = { user: { id: newUser._id, role: newUser.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
        profile_pic: newUser.profile_pic
      },
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: "Server error during registration." });
  }
});

// --- 2. POST: Login an existing user ---
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).lean();

    if (!user) {
      return res.status(400).json({ message: "Invalid Email or Password." });
    }

    if (user.role !== role) {
      return res.status(403).json({
        message: `Access denied. You are registered as a ${user.role}, please use the ${user.role} portal.`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Email or Password." });
    }

    const payload = { user: { id: user._id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        profile_pic: user.profile_pic,
      },
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Server error during login." });
  }
});

// --- 3. GET: Get current logged-in user data ---
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password").lean();
    res.json(user);
  } catch (err) {
    console.error("Fetch User Error:", err);
    res.status(500).json({ message: "Server error fetching user data." });
  }
});

// --- 4. POST: Google Sign In & Account Merging ---
router.post("/google", async (req, res) => {
  try {
    const { token, role } = req.body;
    if (!token || !role) {
      return res.status(400).json({ message: "Token and role are required." });
    }

    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email, name, sub: googleId } = ticket.getPayload();
    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail, role }).lean();

    if (user) {
      const payload = { user: { id: user._id, role: user.role } };
      const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });

      return res.status(200).json({
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          profile_pic: user.profile_pic,
        },
        token: jwtToken,
      });
    } else {
      return res.status(200).json({
        requirePhone: true,
        tempGoogleData: { email: normalizedEmail, name, googleId },
      });
    }
  } catch (err) {
    console.error("Google Auth Error:", err);
    res.status(401).json({ message: "Invalid Google Token" });
  }
});

// --- 5. POST: Complete Google Profile ---
router.post("/google/complete", async (req, res) => {
  try {
    const { email, name, googleId, phone, role } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    let userExists = await User.findOne({
      email: normalizedEmail,
      role,
    }).lean();
    if (userExists) {
      return res.status(400).json({ message: "User already exists." });
    }

    const dummyPassword = Math.random().toString(36).slice(-12) + "A1!";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dummyPassword, salt);

    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "Student",
      phone: phone ? phone.trim() : "",
      googleId,
    });

    await newUser.save();

    const payload = { user: { id: newUser._id, role: newUser.role } };
    const jwtToken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token: jwtToken,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
        profile_pic: newUser.profile_pic
      },
    });
  } catch (err) {
    console.error("Complete Profile Error:", err);
    res.status(500).json({ message: "Server error creating account." });
  }
});

// --- 6. POST: Forgot Password ---
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, role } = req.body;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail, role });

    if (!user) {
      return res.status(200).json({
        message: "If that email exists, a reset link has been sent.",
      });
    }

    // Generate secure token and set 1-hour expiration
    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpire = Date.now() + 3600000;
    await user.save();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // 👇 PASTE YOUR GOOGLE SCRIPT URL HERE 👇
    const scriptUrl =
      "https://script.google.com/macros/s/AKfycbynkKetyXGGRcwgIG6gN2_SYi-nuohtgAqggZMNEeHzYXu6SYjPTxLHgVyvlNpkaKRH/exec";

    // Ping your custom Google API
    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secretKey: "StudyHub_API_Secure_2026", // Must match the script exactly
        to: user.email,
        subject: "Password Reset Request - StudyHub",
        htmlBody: `
          <h2>Password Reset Request</h2>
          <p>You requested to reset your password for your ${user.role} account.</p>
          <p>Please click the button below to choose a new password. This link will expire in 1 hour.</p>
          <a href="${resetUrl}" style="background-color: #2563EB; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px;">Reset Password</a>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">If you didn't request this, please ignore this email.</p>
        `,
      }),
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    console.log(`Password reset email sent to: ${normalizedEmail}`);
    res.status(200).json({ message: "Password reset instructions sent." });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ message: "Server error processing request." });
  }
});

// --- 7. POST: Reset Password ---
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    // Hash the token from the URL to match what we saved in the database earlier
    const resetPasswordToken = crypto.createHash("sha256").update(token).digest("hex");

    // Find the user with this token, ensuring it hasn't expired ($gt means "greater than")
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset link." });
    }

    // Hash the new password and update the user document
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Clear the reset tokens so the link cannot be used again
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successful! You can now log in." });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ message: "Server error resetting password." });
  }
});

// --- 8. PUT: Upload Owner Profile Picture ---
// upload.single("profile_pic") tells the helper to expect ONE file named "profile_pic"
router.put("/profile-pic", authMiddleware, upload.single("profile_pic"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided." });
    }

    // req.file.path is the magical URL Cloudinary just generated for us
    const cloudUrl = req.file.path;

    // Find the logged-in user and update their profile_pic field
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { profile_pic: cloudUrl },
      { new: true } 
    ).select("-password");

    res.status(200).json({
      message: "Profile picture saved!",
      user: updatedUser,
    });
  } catch (err) {
    console.error("Profile Pic Upload Error:", err);
    res.status(500).json({ message: "Server error saving profile picture." });
  }
});

module.exports = router;
