require("dotenv").config();

const requiredEnvVars = [
  "MONGO_URI",
  "JWT_SECRET",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET"
];

const missingVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);
if (missingVars.length > 0) {
  console.error(`💥 FATAL ERROR: Missing required environment variables: ${missingVars.join(", ")}`);
  process.exit(1); // Instantly kills the server before it can accept bad traffic
}

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http"); 
const { Server } = require("socket.io"); 
const compression = require("compression");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require('express-mongo-sanitize'); // 👈 UNCOMMENTED

// --- ROUTE IMPORTS ---
const pushRoutes = require("./routes/push");
const subscriptionRoutes = require("./routes/subscription");
const webhookRoutes = require("./routes/webhook");
const { startAutomation } = require("./services/automation");

// 👇 Initialize Express FIRST
const app = express();

// --- 1. RAW WEBHOOK ROUTE (MUST BE BEFORE express.json) ---
// We place this here so Razorpay's raw body isn't parsed into JSON, which breaks signature verification.
app.use("/api/webhooks", webhookRoutes);

// --- 2. SERVER & SOCKET SETUP ---
app.use(compression());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.set("io", io);

io.on("connection", (socket) => {
  console.log(`⚡ A user connected: ${socket.id}`);

  socket.on("join_user_room", (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined their personal notification room.`);
  });

  socket.on("disconnect", () => {
    console.log(`🔴 User disconnected: ${socket.id}`);
  });
});

// --- 3. BASIC MIDDLEWARE ---
app.set("trust proxy", 1);
app.use(cors());

// Now we can safely parse JSON for all other standard routes
app.use(express.json({ limit: "10kb" })); 

// 🚨 NEW: Sanitize data to prevent NoSQL Operator Injections ($gt,$set)
app.use(mongoSanitize());

// --- 4. SECURITY MIDDLEWARE ---
app.use(helmet());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true, 
  legacyHeaders: false, 
  message: {
    message: "Too many requests from this IP, please try again in 15 minutes.",
  },
});
app.use("/api", limiter); 

// 🚨 NEW: Strict Limiter for sensitive routes (Prevents Brute Force)
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Max 20 attempts per hour
  message: { message: "Too many attempts, please try again after an hour." }
});
app.use("/api/auth/login", strictLimiter);
app.use("/api/subscriptions/create", strictLimiter);


// --- 5. ROUTES ---
app.use("/api/push", pushRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "online",
    message: "Server is awake!",
    timestamp: new Date().toISOString(),
  });
});

const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);

const libraryRoutes = require("./routes/Library");
app.use("/api/libraries", libraryRoutes);

const enrollmentRoutes = require("./routes/enrollment");
app.use("/api/enrollments", enrollmentRoutes);

app.use("/api/users", require("./routes/user"));
app.use("/api/payments", require("./routes/payment"));

const cronRoutes = require("./utils/cronJobs");
app.use("/api/cron", cronRoutes);

// --- 6. STARTUP ---
app.get("/", (req, res) => {
  res.send("Library SaaS Engine is breathing! 🚀");
});

mongoose
  .connect(process.env.MONGO_URI)
  .then((conn) => console.log(`✅ Securely connected to MongoDB Vault! Database Name: ${conn.connection.name}`))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

startAutomation(io);
console.log("🤖 Background Automation Engine Started with Live WebSockets");

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🔥 Server Engine running on http://localhost:${PORT}`);
});