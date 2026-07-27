// Load environment variables from the .env file
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// 👇 FIX: Moved the automation import to the top with the others
const { startAutomation } = require('./services/automation'); 

const app = express();

// Middleware: The security guards and translators
app.use(cors()); // Allows your React frontend to communicate with this backend
app.use(express.json()); // Tells the server to understand JSON data

// Import and use our Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

const libraryRoutes = require('./routes/Library');
app.use('/api/libraries', libraryRoutes);

const enrollmentRoutes = require('./routes/enrollment');
app.use('/api/enrollments', enrollmentRoutes);

app.use('/api/users', require('./routes/user'));
app.use('/api/payments', require('./routes/payment'));

// A quick test route to make sure the engine is running
app.get('/', (req, res) => {
  res.send('Library SaaS Engine is breathing! 🚀');
});

// The Bridge to the Vault: Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Securely connected to MongoDB Vault!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));


// 👇 FIX: Start the robot right BEFORE you open the server to traffic
startAutomation(); 
console.log("🤖 Background Automation Engine Started");

// Ignition: Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔥 Server Engine running on http://localhost:${PORT}`);
});