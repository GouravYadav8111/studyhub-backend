// Load environment variables from the .env file
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Middleware: The security guards and translators
app.use(cors()); // Allows your React frontend to communicate with this backend
app.use(express.json()); // Tells the server to understand JSON data
// Import and use our new Auth Routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Import and use our new Library Routes
const libraryRoutes = require('./routes/Library');
app.use('/api/libraries', libraryRoutes);

// Import and use our new Enrollment Routes
const enrollmentRoutes = require('./routes/enrollment');
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/users', require('./routes/user'));

// for our payment.js file
app.use('/api/payments', require('./routes/payment'));

// A quick test route to make sure the engine is running
app.get('/', (req, res) => {
  res.send('Library SaaS Engine is breathing! 🚀');
});

// The Bridge to the Vault: Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Securely connected to MongoDB Vault!'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// Ignition: Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔥 Server Engine running on http://localhost:${PORT}`);
});