const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const User = require("../models/User"); // Adjust path if your models folder is different

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

exports.processGoogleAuth = async (token, role) => {
  // 1. Verify the token securely with Google
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const { email, name, sub: googleId } = ticket.getPayload();

  // 2. Check if user already exists
  const user = await User.findOne({ email, role });

  if (user) {
    // Return existing user to be logged in immediately
    return {
      isComplete: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
      },
      token: generateToken(user._id),
    };
  }

  // Return flag indicating they need to complete their profile (missing phone)
  return {
    isComplete: false,
    tempGoogleData: { email, name, googleId },
  };
};

exports.finalizeGoogleRegistration = async (userData) => {
  const { email, name, googleId, phone, role } = userData;

  const userExists = await User.findOne({ email, role });
  if (userExists) {
    throw new Error("User already exists");
  }

  // Create the new user with a randomized secure password bypass
  const user = await User.create({
    name,
    email,
    phone,
    role,
    googleId,
    password: Math.random().toString(36).slice(-12) + "A1!",
  });

  return {
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
    },
    token: generateToken(user._id),
  };
};

exports.processPasswordReset = async (email, role) => {
  const user = await User.findOne({ email, role });

  if (!user) {
    return false; // Silently fail to prevent email enumeration
  }

  // TODO: Integrate NodeMailer/SendGrid here to email the reset link
  console.log(`Password reset requested for: ${email}`);
  return true;
};
