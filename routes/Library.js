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
    if (library.owner.toString() !== req.user.id) {
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

module.exports = router;
