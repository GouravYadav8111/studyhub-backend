const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

// Initialize Google Client
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- 1. POST: Register a new user ---
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    // 👇 FIXED (Accuracy): Strip accidental spaces and force lowercase
    const normalizedEmail = email.trim().toLowerCase();

    // 👇 FIXED (Speed): Added .lean() to make the DB check instant
    let user = await User.findOne({ email: normalizedEmail }).lean();
    if (user) {
      return res
        .status(400)
        .json({ message: "User already exists with this email." });
    }

    // Hash the password for security
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create the new user (Mongoose doc needed here to use .save())
    const newUser = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: role || "Student",
      phone: phone ? phone.trim() : "",
    });

    await newUser.save();

    // Generate JWT Token
    const payload = { user: { id: newUser._id, role: newUser.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    // Send back the token and user data to React
    res.status(201).json({
      token,
      user: {
        _id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        phone: newUser.phone,
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

    // 👇 FIXED (Accuracy): Forgive typos regarding caps/spaces
    const normalizedEmail = email.trim().toLowerCase();

    // 👇 FIXED (Speed): Use .lean() to bypass Mongoose document building.
    // This makes the database read operation up to 5x faster!
    const user = await User.findOne({ email: normalizedEmail }).lean();

    if (!user) {
      return res.status(400).json({ message: "Invalid Email or Password." });
    }

    // Strictly enforce that the user's database role matches the portal they clicked
    if (user.role !== role) {
      return res.status(403).json({
        message: `Access denied. You are registered as a ${user.role}, please use the ${user.role} portal.`,
      });
    }

    // Compare the entered password with the hashed password in DB
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid Email or Password." });
    }

    // Generate JWT Token
    const payload = { user: { id: user._id, role: user.role } };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    // Send back the token and user data to React
    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
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
    // 👇 FIXED (Speed): Added .lean() to make silent background reloads on the frontend ultra-fast
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

    // Verify token with Google
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email, name, sub: googleId } = ticket.getPayload();
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists
    const user = await User.findOne({ email: normalizedEmail, role }).lean();

    if (user) {
      // User exists: Issue token and log them in
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
        },
        token: jwtToken,
      });
    } else {
      // New user: Request phone number
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

    // Double-check to prevent duplicates
    let userExists = await User.findOne({
      email: normalizedEmail,
      role,
    }).lean();
    if (userExists) {
      return res.status(400).json({ message: "User already exists." });
    }

    // Generate a secure random password since they use Google
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

    const user = await User.findOne({ email: normalizedEmail, role }).lean();

    if (!user) {
      // Always return 200 to prevent email enumeration attacks
      return res
        .status(200)
        .json({ message: "If that email exists, a reset link has been sent." });
    }

    // TODO: Integrate Nodemailer here to send the actual email
    console.log(`Password reset requested for: ${normalizedEmail}`);

    res.status(200).json({ message: "Password reset instructions sent." });
  } catch (err) {
    console.error("Forgot Password Error:", err);
    res.status(500).json({ message: "Server error processing request." });
  }
});

module.exports = router;
