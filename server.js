require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http'); // 👈 NEW: 1. Import Node's native HTTP module
const { Server } = require('socket.io'); // 👈 NEW: 2. Import Socket.io

const pushRoutes = require('./routes/push');
// 👇 NEW: Import Security Packages
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
// const mongoSanitize = require('express-mongo-sanitize');
// const xss = require('xss-clean');

const { startAutomation } = require('./services/automation'); 

const compression = require('compression');
const app = express();
app.use(compression());

// 👈 NEW: 3. Create a raw HTTP server and wrap your Express app inside it
const server = http.createServer(app); 

// 👈 NEW: 4. Attach Socket.io to that server with CORS permissions
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// 👈 NEW: 5. Make 'io' globally accessible so your route files can trigger notifications!
app.set('io', io);

// 👈 NEW: 6. Listen for incoming WebSocket connections
io.on('connection', (socket) => {
  console.log(`⚡ A user connected: ${socket.id}`);

  // When a user logs in, they send their User ID to join their own personal "Room"
  socket.on('join_user_room', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their personal notification room.`);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
  });
});

// 👇 Tell rate limiter to trust Render's proxy
app.set('trust proxy', 1);

// --- 1. BASIC MIDDLEWARE ---
app.use(cors()); 
app.use(express.json({ limit: '10kb' })); // Security: Limit body size so attackers can't crash server with massive payloads

// --- 2. SECURITY MIDDLEWARE ---
// Set security HTTP headers
app.use(helmet());
app.use('/api/push', pushRoutes);

// Sanitize data against NoSQL query injection
// app.use(mongoSanitize());

// Sanitize data against XSS
// app.use(xss());

// Global Rate Limiting: Limit each IP to 100 requests per 15 minutes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // 👇 FIXED: This must be an object so your React app receives JSON, not raw text!
  message: { message: 'Too many requests from this IP, please try again in 15 minutes.' }
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

startAutomation(io); 
console.log("🤖 Background Automation Engine Started with Live WebSockets");

const PORT = process.env.PORT || 5000;

// 👈 NEW: 7. Change app.listen to server.listen so both Express and WebSockets run together!
server.listen(PORT, () => {
  console.log(`🔥 Server Engine running on http://localhost:${PORT}`);
});