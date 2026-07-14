const express = require('express');
const User = require('../models/User');
const Library = require('../models/Library');
const Enrollment = require('../models/Enrollment');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// --- 1. GET ALL USERS (SuperAdmin Only) ---
router.get('/', authMiddleware, async (req, res) => {
  try {
    // The exact check that was throwing the error
    if (req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ message: 'God Mode required.' });
    }
    
    const users = await User.find().select('-password'); 
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching users.' });
  }
});

// --- 2. CASCADING DELETE USER (SuperAdmin Only) ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ message: 'Access Denied.' });
    }

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
router.post('/favorites/:libraryId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Student') return res.status(403).json({ message: 'Only students can favorite libraries.' });

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
router.get('/favorites', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.favorite_libraries || []);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching favorites.' });
  }
});



// --- 5. UPDATE USER PROFILE ---
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
router.get('/todos', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.todos || []);
  } catch (err) { res.status(500).json({ message: 'Error fetching todos' }); }
});

router.put('/todos', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    user.todos = req.body.todos;
    await user.save();
    res.json(user.todos);
  } catch (err) { res.status(500).json({ message: 'Error saving todos' }); }
});


// --- 7. STUDENT: DIGITAL WELLBEING TIMER ---
router.get('/study-time', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.daily_study_time || []);
  } catch (err) { res.status(500).json({ message: 'Error fetching study time' }); }
});

router.post('/study-time', authMiddleware, async (req, res) => {
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
router.get('/admin/stats', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ message: 'Access Denied: SuperAdmin only.' });
    }

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

module.exports = router;