const express = require('express');
const User = require('../models/User');
const Library = require('../models/Library');
const Enrollment = require('../models/Enrollment');
const authMiddleware = require('../middleware/authMiddleware');
const authorizeRoles = require('../middleware/roleMiddleware');

const router = express.Router();

// --- 1. GET ALL USERS (SuperAdmin Only) ---
// 🔒 Secured: Only SuperAdmins
router.get('/', authMiddleware, authorizeRoles('SuperAdmin'), async (req, res) => {
  try {
    const users = await User.find().select('-password'); 
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching users.' });
  }
});

// --- 2. CASCADING DELETE USER (SuperAdmin Only) ---
// 🔒 Secured: Only SuperAdmins
router.delete('/:id', authMiddleware, authorizeRoles('SuperAdmin'), async (req, res) => {
  try {
    const userToDelete = await User.findById(req.params.id);
    if (!userToDelete) return res.status(404).json({ message: 'User not found.' });

    // Cascade delete logic
    if (userToDelete.role === 'LibraryOwner') {
      const libraries = await Library.find({ owner_id: userToDelete._id });
      for (let lib of libraries) {
        await Enrollment.deleteMany({ library_id: lib._id });
        await Library.findByIdAndDelete(lib._id);
      }
    } else if (userToDelete.role === 'Student') {
      await Enrollment.deleteMany({ student_id: userToDelete._id });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User and all associated data completely purged.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error deleting user.' });
  }
});


// --- 3. STUDENT: TOGGLE FAVORITE LIBRARY ---
// 🔒 Secured: Only Students
router.post('/favorites/:libraryId', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const libraryId = req.params.libraryId;

    // Safely check if it exists in the array
    const isFavorited = user.favorite_libraries.some(id => id.toString() === libraryId);
    
    if (isFavorited) {
      user.favorite_libraries = user.favorite_libraries.filter(id => id.toString() !== libraryId);
    } else {
      user.favorite_libraries.push(libraryId);
    }

    await user.save();
    res.json({ message: isFavorited ? 'Removed from favorites' : 'Added to favorites', favorites: user.favorite_libraries });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating favorites.' });
  }
});

// --- 4. STUDENT: GET FAVORITES ---
// 🔒 Secured: Only Students
router.get('/favorites', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.favorite_libraries || []);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching favorites.' });
  }
});


// --- 5. UPDATE USER PROFILE ---
// 🟢 Open: ANY logged-in user can update their own profile
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const { name, email, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    
    if (!user) return res.status(404).json({ message: 'User not found.' });

    if (name) user.name = name;
    if (email) user.email = email;
    
    if (newPassword) {
      const bcrypt = require('bcryptjs'); // Brought in safely to hash the new password
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    await user.save();
    res.json({ message: 'Profile updated successfully! (Name/Email changes will reflect on next login)' });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating profile.' });
  }
});


// --- 6. STUDENT: GET & UPDATE TO-DOS ---
// 🔒 Secured: Only Students
router.get('/todos', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.todos || []);
  } catch (err) { res.status(500).json({ message: 'Error fetching todos' }); }
});

router.put('/todos', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.todos = req.body.todos;
    await user.save();
    res.json(user.todos);
  } catch (err) { res.status(500).json({ message: 'Error saving todos' }); }
});


// --- 7. STUDENT: DIGITAL WELLBEING TIMER ---
// 🔒 Secured: Only Students
router.get('/study-time', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.daily_study_time || []);
  } catch (err) { res.status(500).json({ message: 'Error fetching study time' }); }
});

router.post('/study-time', authMiddleware, authorizeRoles('Student'), async (req, res) => {
  try {
    const { date, seconds } = req.body;
    const user = await User.findById(req.user.id);
    
    // Check if the user already has study time logged for today
    const existingDate = user.daily_study_time.find(d => d.date === date);
    
    if (existingDate) {
      existingDate.seconds += Number(seconds);
    } else {
      user.daily_study_time.push({ date, seconds: Number(seconds) });
    }
    
    await user.save();
    res.json(user.daily_study_time);
  } catch (err) { res.status(500).json({ message: 'Error saving study time' }); }
});


// --- 8. SUPERADMIN: GLOBAL METRICS ---
// 🔒 Secured: Only SuperAdmins
router.get('/admin/stats', authMiddleware, authorizeRoles('SuperAdmin'), async (req, res) => {
  try {
    const User = require('../models/User');
    const Library = require('../models/Library');
    const Enrollment = require('../models/Enrollment');

    const totalUsers = await User.countDocuments();
    const totalLibraries = await Library.countDocuments();
    
    // Calculate global seat occupancy
    const allLibraries = await Library.find();
    const globalTotalSeats = allLibraries.reduce((acc, lib) => acc + lib.total_seats, 0);
    const globalOccupiedSeats = allLibraries.reduce((acc, lib) => acc + lib.occupied_seats, 0);
    
    // Count how many students are actively studying right now
    const activeSessions = await Enrollment.countDocuments({ status: 'Active' });

    res.json({
      totalUsers,
      totalLibraries,
      globalTotalSeats,
      globalOccupiedSeats,
      activeSessions
    });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching global stats' });
  }
});

const Notification = require('../models/Notification'); 

// --- 9. GET ALL NOTIFICATIONS FOR A USER ---
// 🟢 Open: All roles have notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  try {
    // Find notifications for this user, sort by newest first
    const notifications = await Notification.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Server Error");
  }
});

// --- 10. MARK ALL NOTIFICATIONS AS READ ---
// 🟢 Open: All roles can mark their notifications as read
router.put('/notifications/mark-read', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany(
      { user_id: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    res.json({ success: true, message: "All caught up!" });
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Server Error");
  }
});

module.exports = router;