require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// 👇 NEW: Import Security Packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const { startAutomation } = require('./services/automation'); 

const app = express();
// 👇 NEW: Tell rate limiter to trust Render's proxy
app.set('trust proxy', 1);

// --- 1. BASIC MIDDLEWARE ---
app.use(cors()); 
app.use(express.json({ limit: '10kb' })); // Security: Limit body size so attackers can't crash server with massive payloads

// --- 2. SECURITY MIDDLEWARE ---
// Set security HTTP headers
app.use(helmet());

// Sanitize data against NoSQL query injection
app.use(mongoSanitize());

// Sanitize data against XSS
app.use(xss());

// Global Rate Limiting: Limit each IP to 100 requests per 15 minutes
const limiter = rateLimit({
  max: 100,
  windowMs: 15 * 60 * 1000, 
  message: 'Too many requests from this IP, please try again in 15 minutes.'
});
app.use('/api', limiter); // Apply this rule to all /api routes

// --- 3. ROUTES ---
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const libraryRoutes = require('./routes/Library');
app.use('/api/libraries', libraryRoutes);

const enrollmentRoutes = require('./routes/enrollment');
app.use('/api/enrollments', enrollmentRoutes);

app.use('/api/users', require('./routes/user'));
app.use('/api/payments', require('./routes/payment'));

// --- 4. STARTUP ---
app.get('/', (req, res) => {
  res.send('Library SaaS Engine is breathing! 🚀');
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Securely connected to MongoDB Vault!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

startAutomation(); 
console.log("🤖 Background Automation Engine Started");

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔥 Server Engine running on http://localhost:${PORT}`);
});