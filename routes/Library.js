const express = require("express");
const Library = require("../models/Library");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User"); // 👈 NEW: We need this to wipe the human account
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// --- 1. CREATE A NEW LIBRARY ---
router.post("/", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "LibraryOwner")
      return res.status(403).json({ message: "Access Denied." });

    // 👈 NEW: Added description and amenities to the request body
    const { name, total_seats, location, description, amenities } = req.body;

    const newLibrary = new Library({
      name,
      total_seats,
      location,
      description,
      amenities,
      owner_id: req.user.id,
    });

    await newLibrary.save();
    res.status(201).json(newLibrary);
  } catch (err) {
    res.status(500).json({ message: "Server error creating library." });
  }
});

// --- 2. GET LIBRARIES (Filtered by Role) ---
router.get("/", authMiddleware, async (req, res) => {
  try {
    let filter = {};
    // If it's a student, ONLY show them Approved libraries
    if (req.user.role === "Student") {
      filter = { status: "Approved" };
    }

    const libraries = await Library.find(filter).populate(
      "owner_id",
      "name email",
    );
    res.json(libraries);
  } catch (err) {
    res.status(500).json({ message: "Server error fetching libraries." });
  }
});

// --- 3. SUPERADMIN: APPROVE/REJECT LIBRARY ---
router.put("/:id/status", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "SuperAdmin")
      return res.status(403).json({ message: "God Mode required." });

    const { status } = req.body; // 'Approved' or 'Rejected'
    const library = await Library.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true },
    );

    res.json({ message: `Library has been ${status}!`, library });
  } catch (err) {
    res.status(500).json({ message: "Server error updating library status." });
  }
});

// --- 4. SUPERADMIN: NUCLEAR DELETE (Library, Seats, AND Owner) ---
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "SuperAdmin")
      return res.status(403).json({ message: "Access Denied." });

    const libraryId = req.params.id;
    const libraryToDelete = await Library.findById(libraryId);

    if (!libraryToDelete)
      return res.status(404).json({ message: "Library not found." });

    // 1. Destroy the Owner's User Account (Frees up the email!)
    if (libraryToDelete.owner_id) {
      await User.findByIdAndDelete(libraryToDelete.owner_id);
    }

    // 2. Destroy the Library itself
    await Library.findByIdAndDelete(libraryId);

    // 3. Destroy all Student Seats attached to this library
    await Enrollment.deleteMany({ library_id: libraryId });

    res.json({
      message:
        "Total Wipe Complete: Library, Seats, and Owner account have been erased.",
    });
  } catch (err) {
    res.status(500).json({ message: "Server error deleting library data." });
  }
});

// --- 5. STUDENT: ADD A REVIEW ---
router.post("/:id/reviews", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "Student")
      return res
        .status(403)
        .json({ message: "Only students can leave reviews." });

    const { rating, comment } = req.body;
    const library = await Library.findById(req.params.id);
    if (!library)
      return res.status(404).json({ message: "Library not found." });

    // Prevent double-reviewing
    const alreadyReviewed = library.reviews.find(
      (r) => r.student_id.toString() === req.user.id,
    );
    if (alreadyReviewed)
      return res
        .status(400)
        .json({ message: "You have already reviewed this library." });

    // Fetch the user to get their name for the review display
    const User = require("../models/User");
    const user = await User.findById(req.user.id);

    // Create and add the review
    const review = {
      student_id: req.user.id,
      student_name: user.name,
      rating: Number(rating),
      comment,
    };

    library.reviews.push(review);

    // Calculate the new average rating
    library.rating =
      library.reviews.reduce((acc, item) => item.rating + acc, 0) /
      library.reviews.length;

    await library.save();
    res.json(library); // Send back the updated library
  } catch (err) {
    res.status(500).json({ message: "Server error while adding review." });
  }
});

// --- 6. GET SEAT STATUS FOR A LIBRARY ---
router.get("/:id/seat-status", authMiddleware, async (req, res) => {
  try {
    const Enrollment = require("../models/Enrollment");
    const Library = require("../models/Library"); // Need this to fetch blocked seats

    // 1. Get booked seats
    const activeRequests = await Enrollment.find({
      library_id: req.params.id,
      status: { $in: ["Pending", "Active"] },
    });
    const bookedSeats = activeRequests
      .map((req) => req.seat_number)
      .filter(Boolean);

    // 2. Get blocked seats
    const library = await Library.findById(req.params.id);

    // Send BOTH arrays to the frontend
    res.json({
      booked: bookedSeats,
      blocked: library.blocked_seats || [],
    });
  } catch (err) {
    res.status(500).json({ message: "Server error getting seat status." });
  }
});

// --- 7. OWNER: TOGGLE SEAT BLOCK STATUS ---
router.post("/:id/seats/block", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "LibraryOwner")
      return res.status(403).json({ message: "Access Denied." });

    const { seat_number } = req.body;
    const library = await Library.findById(req.params.id);

    if (!library)
      return res.status(404).json({ message: "Library not found." });

    // Check if the seat is already blocked
    const isBlocked = library.blocked_seats.includes(seat_number);

    if (isBlocked) {
      // Unblock it (remove from array)
      library.blocked_seats = library.blocked_seats.filter(
        (seat) => seat !== seat_number,
      );
    } else {
      // Block it (add to array)
      library.blocked_seats.push(seat_number);
    }

    await library.save();
    res.json({
      message: "Seat status updated!",
      blocked_seats: library.blocked_seats,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error updating seat status." });
  }
});


// Add this route to handle Direct Walk-In assignments
router.post('/:id/walk-in', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { seat_number, student_name, student_phone, duration_days } = req.body;

    // 1. Find the library
    const library = await Library.findById(id);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

   // 2. Security Check: Ensure only the actual owner can assign a walk-in
    const currentUserId = req.user.id || req.user._id; // Handles both common token setups
    if (library.owner_id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ error: 'Unauthorized. Only the owner can do this.' });
    }

    // 3. Validation: Check if seat is blocked
    if (library.blocked_seats.includes(seat_number)) {
      return res.status(400).json({ error: 'Cannot assign a blocked seat.' });
    }

    // 4. Validation: Check if seat is already occupied in the new or old system
    const isOccupied = library.seat_allocations.some(seat => seat.seat_number === seat_number);
    const isLegacyBooked = library.booked_seats && library.booked_seats.includes(seat_number);

    if (isOccupied || isLegacyBooked) {
      return res.status(400).json({ error: 'Seat is already occupied.' });
    }

    // 5. Calculate the exact expiration date
    const start_date = new Date();
    const end_date = new Date();
    end_date.setDate(start_date.getDate() + Number(duration_days));

    // 6. Create the allocation package
    const newAllocation = {
      seat_number,
      student_name,
      student_phone,
      start_date,
      end_date,
      booking_type: 'Walk-In'
    };

    // 7. Save to the new array
    library.seat_allocations.push(newAllocation);

    // Keep your existing frontend grid working by adding the seat to the old array too
    if (!library.booked_seats) library.booked_seats = [];
    library.booked_seats.push(seat_number);

    await library.save();

    res.status(200).json({ 
      message: 'Walk-In assigned successfully!', 
      allocation: newAllocation 
    });

  } catch (error) {
    console.error("Walk-In Error:", error);
    res.status(500).json({ error: 'Server error assigning seat' });
  }
});


// GET all active members/allocations for a specific library
router.get('/:id/members', authMiddleware, async (req, res) => {
  try {
    const library = await Library.findById(req.params.id);
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Security Check: Only the owner can see the private member list
    const currentUserId = req.user.id || req.user._id;
    if (library.owner_id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ error: 'Unauthorized to view members.' });
    }

    // Return the allocations array we built earlier
    res.status(200).json(library.seat_allocations || []);

  } catch (error) {
    console.error("Fetch Members Error:", error);
    res.status(500).json({ error: 'Server error fetching members' });
  }
});

// Handle Seat Checkout / Eviction by Owner
router.post('/:id/checkout', authMiddleware, async (req, res) => {
  try {
    const { seat_number } = req.body;
    const library = await Library.findById(req.params.id);
    
    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Security Check: Only the owner can checkout a seat
    const currentUserId = req.user.id || req.user._id;
    if (library.owner_id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ error: 'Unauthorized. Only the owner can do this.' });
    }

    // 1. Remove the student from the detailed seat_allocations array
    library.seat_allocations = library.seat_allocations.filter(
      seat => seat.seat_number !== seat_number
    );

    // 2. Remove the seat from the legacy booked_seats array (so it turns Green instantly)
    if (library.booked_seats) {
      library.booked_seats = library.booked_seats.filter(
        num => num !== seat_number
      );
    }

    await library.save();
    res.status(200).json({ message: 'Seat checked out successfully' });

  } catch (error) {
    console.error("Checkout Error:", error);
    res.status(500).json({ error: 'Server error during checkout' });
  }
});

// PUT: Update Library Pricing & Payment Credentials
router.put('/:id/settings', authMiddleware, async (req, res) => {
  try {
    const { monthly_rate, razorpay_key_id, razorpay_key_secret } = req.body;
    const library = await Library.findById(req.params.id);

    if (!library) {
      return res.status(404).json({ error: 'Library not found' });
    }

    // Security Check: Only the designated owner can modify settings
    const currentUserId = req.user.id || req.user._id;
    if (library.owner_id.toString() !== currentUserId.toString()) {
      return res.status(403).json({ error: 'Unauthorized. Only the library owner can update settings.' });
    }

    // Apply updates with fallback defaults
    library.pricing = {
      monthly_rate: Number(monthly_rate) > 0 ? Number(monthly_rate) : 1000
    };

    library.payment_settings = {
      razorpay_key_id: razorpay_key_id ? razorpay_key_id.trim() : "",
      razorpay_key_secret: razorpay_key_secret ? razorpay_key_secret.trim() : ""
    };

    await library.save();
    res.status(200).json({ message: 'Settings saved successfully', library });

  } catch (error) {
    console.error("Settings Update Error:", error);
    res.status(500).json({ error: 'Server error while updating settings' });
  }
});


module.exports = router;
