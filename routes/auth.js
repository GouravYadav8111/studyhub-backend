const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

    // 1. Generate a secure, random verification token
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const hashedVerificationToken = crypto
      .createHash("sha256")
      .update(verificationToken)
      .digest("hex");

    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "Student",
      phone: phone ? phone.trim() : "",
      isVerified: false, // 🔒 Lock account until verified
      verificationToken: hashedVerificationToken,
    });

    await newUser.save();

    // 2. Fire the email via your free Google Apps Script API
    const verifyUrl = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/auth/verify-email/${verificationToken}`;
    const scriptUrl =
      "https://script.google.com/macros/s/AKfycbynkKetyXGGRcwgIG6gN2_SYi-nuohtgAqggZMNEeHzYXu6SYjPTxLHgVyvlNpkaKRH/exec";

    // We don't await this fetch so the API responds to the user instantly (Optimized!)
    fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secretKey: "StudyHub_API_Secure_2026",
        to: newUser.email,
        subject: "Verify your StudySpace Account",
        htmlBody: `
          <h2>Welcome to StudySpace, ${newUser.name}!</h2>
          <p>Please verify your email address to activate your ${newUser.role} account.</p>
          <a href="${verifyUrl}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; margin-top: 15px;">Verify My Account</a>
          <p style="margin-top: 25px; font-size: 12px; color: #666;">If you didn't create this account, you can safely ignore this email.</p>
        `,
      }),
    }).catch((err) => console.error("Background Email Error:", err));

    // 3. Return a specific flag so the frontend knows NOT to log them in yet
    res.status(201).json({
      requiresVerification: true,
      message:
        "Registration successful. Please check your email to verify your account.",
    });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: "Server error during registration." });
  }
});

// --- NEW: GET: Verify Email Click ---
router.get("/verify-email/:token", async (req, res) => {
  try {
    const hashedToken = crypto
      .createHash("sha256")
      .update(req.params.token)
      .digest("hex");

    const user = await User.findOne({ verificationToken: hashedToken });
    if (!user) {
      return res.status(400).send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h2 style="color: #E11D48;">Invalid or Expired Link</h2>
          <p>Please try registering again or contact support.</p>
        </div>
      `);
    }

    // Unlock the account and destroy the token
    user.isVerified = true;
    user.verificationToken = undefined;

    // NEW: If they were changing their email, finalize the swap now!
    if (user.pendingEmail) {
      user.email = user.pendingEmail;
      user.pendingEmail = undefined;
    }

    await user.save();

    // Redirect the user straight back to your frontend app login page
    res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:5173"}?verified=true`,
    );
  } catch (err) {
    console.error("Verification Error:", err);
    res.status(500).send("Server Error");
  }
});

// --- 2. POST: Login an existing user ---
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).lean();

    if (!user)
      return res.status(400).json({ message: "Invalid Email or Password." });

    // 🔒 Security Check: Ensure email is verified
    if (user.isVerified === false) {
      return res
        .status(403)
        .json({
          message:
            "Please check your email and verify your account before logging in.",
        });
    }

    if (user.role !== role) {
      return res.status(403).json({
        message: `Access denied. You are registered as a ${user.role}.`,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid Email or Password." });

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
        profile_pic: newUser.profile_pic,
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
    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    // Find the user with this token, ensuring it hasn't expired ($gt means "greater than")
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset link." });
    }

    // Hash the new password and update the user document
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Clear the reset tokens so the link cannot be used again
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res
      .status(200)
      .json({ message: "Password reset successful! You can now log in." });
  } catch (err) {
    console.error("Reset Password Error:", err);
    res.status(500).json({ message: "Server error resetting password." });
  }
});

// --- 8. PUT: Upload Owner Profile Picture (Swap & Delete) ---
router.put(
  "/profile-pic",
  authMiddleware,
  upload.single("profile_pic"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image file provided." });
      }

      // Find the user FIRST to check if they have an old image
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      // 1. If an old profile picture exists, destroy it on Cloudinary
      if (user.profile_pic) {
        const urlParts = user.profile_pic.split("/");
        const filenameWithExt = urlParts.pop();
        const folder = urlParts.pop();
        const filename = filenameWithExt.split(".")[0];
        const publicId = `${folder}/${filename}`;

        await cloudinary.uploader
          .destroy(publicId)
          .catch((err) => console.error("Old image cleanup error:", err));
      }

      // 2. Set the new Cloudinary URL
      user.profile_pic = req.file.path;
      await user.save();

      // Remove the password from the response object
      const updatedUser = user.toObject();
      delete updatedUser.password;

      res.status(200).json({
        message: "Profile picture updated successfully!",
        user: updatedUser,
      });
    } catch (err) {
      console.error("Profile Pic Upload Error:", err);
      res.status(500).json({ message: "Server error saving profile picture." });
    }
  },
);

// --- 9. DELETE: Manually Remove Profile Picture ---
router.delete("/profile-pic", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user || !user.profile_pic) {
      return res.status(404).json({ message: "No profile picture found." });
    }

    // 1. Extract the Public ID from the current URL
    const urlParts = user.profile_pic.split("/");
    const filenameWithExt = urlParts.pop();
    const folder = urlParts.pop();
    const filename = filenameWithExt.split(".")[0];
    const publicId = `${folder}/${filename}`;

    // 2. Destroy the file on Cloudinary
    await cloudinary.uploader
      .destroy(publicId)
      .catch((err) => console.error("Cloudinary delete error:", err));

    // 3. Clear the URL from MongoDB
    user.profile_pic = "";
    await user.save();

    // Remove the password from the response object
    const updatedUser = user.toObject();
    delete updatedUser.password;

    res.status(200).json({
      message: "Profile picture removed permanently.",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Delete profile picture error:", error);
    res.status(500).json({ message: "Failed to delete profile picture." });
  }
});

module.exports = router;
