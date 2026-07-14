const express = require('express');
const Library = require('../models/Library');
const Enrollment = require('../models/Enrollment');
const User = require('../models/User'); // 👈 NEW: We need this to wipe the human account
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// --- 1. CREATE A NEW LIBRARY ---
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'LibraryOwner') return res.status(403).json({ message: 'Access Denied.' });
    
    // 👈 NEW: Added description and amenities to the request body
    const { name, total_seats, location, description, amenities } = req.body;
    
    const newLibrary = new Library({
      name, 
      total_seats, 
      location, 
      description, 
      amenities, 
      owner_id: req.user.id
    });
    
    await newLibrary.save();
    res.status(201).json(newLibrary);
  } catch (err) {
    res.status(500).json({ message: 'Server error creating library.' });
  }
});

// --- 2. GET LIBRARIES (Filtered by Role) ---
router.get('/', authMiddleware, async (req, res) => {
  try {
    let filter = {};
    // If it's a student, ONLY show them Approved libraries
    if (req.user.role === 'Student') {
      filter = { status: 'Approved' };
    }

    const libraries = await Library.find(filter).populate('owner_id', 'name email');
    res.json(libraries);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching libraries.' });
  }
});

// --- 3. SUPERADMIN: APPROVE/REJECT LIBRARY ---
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'SuperAdmin') return res.status(403).json({ message: 'God Mode required.' });
    
    const { status } = req.body; // 'Approved' or 'Rejected'
    const library = await Library.findByIdAndUpdate(req.params.id, { status }, { new: true });
    
    res.json({ message: `Library has been ${status}!`, library });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating library status.' });
  }
});

// --- 4. SUPERADMIN: NUCLEAR DELETE (Library, Seats, AND Owner) ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'SuperAdmin') return res.status(403).json({ message: 'Access Denied.' });
    
    const libraryId = req.params.id;
    const libraryToDelete = await Library.findById(libraryId);
    
    if (!libraryToDelete) return res.status(404).json({ message: 'Library not found.' });

    // 1. Destroy the Owner's User Account (Frees up the email!)
    if (libraryToDelete.owner_id) {
      await User.findByIdAndDelete(libraryToDelete.owner_id);
    }

    // 2. Destroy the Library itself
    await Library.findByIdAndDelete(libraryId);
    
    // 3. Destroy all Student Seats attached to this library
    await Enrollment.deleteMany({ library_id: libraryId });
    
    res.json({ message: 'Total Wipe Complete: Library, Seats, and Owner account have been erased.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error deleting library data.' });
  }
});

// --- 5. STUDENT: ADD A REVIEW ---
router.post('/:id/reviews', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Student') return res.status(403).json({ message: 'Only students can leave reviews.' });
    
    const { rating, comment } = req.body;
    const library = await Library.findById(req.params.id);
    if (!library) return res.status(404).json({ message: 'Library not found.' });

    // Prevent double-reviewing
    const alreadyReviewed = library.reviews.find(r => r.student_id.toString() === req.user.id);
    if (alreadyReviewed) return res.status(400).json({ message: 'You have already reviewed this library.' });

    // Fetch the user to get their name for the review display
    const User = require('../models/User');
    const user = await User.findById(req.user.id);

    // Create and add the review
    const review = {
      student_id: req.user.id,
      student_name: user.name,
      rating: Number(rating),
      comment
    };
    
    library.reviews.push(review);

    // Calculate the new average rating
    library.rating = library.reviews.reduce((acc, item) => item.rating + acc, 0) / library.reviews.length;

    await library.save();
    res.json(library); // Send back the updated library
  } catch (err) {
    res.status(500).json({ message: 'Server error while adding review.' });
  }
});


// --- 6. GET BOOKED SEATS FOR A LIBRARY ---
router.get('/:id/booked-seats', authMiddleware, async (req, res) => {
  try {
    const Enrollment = require('../models/Enrollment');
    // Find all seats that are currently Pending or Active
    const activeRequests = await Enrollment.find({
      library_id: req.params.id,
      status: { $in: ['Pending', 'Active'] }
    });
    // Extract just the numbers into an array (e.g., [1, 5, 12])
    const bookedSeats = activeRequests.map(req => req.seat_number).filter(Boolean);
    res.json(bookedSeats);
  } catch (err) {
    res.status(500).json({ message: 'Server error getting booked seats.' });
  }
});



module.exports = router;