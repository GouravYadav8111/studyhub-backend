const express = require("express");
const Library = require("../models/Library");
const Enrollment = require("../models/Enrollment");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

const router = express.Router();

// --- 1. CREATE A NEW LIBRARY ---
// 🔒 Secured: Only LibraryOwners can hit this route
router.post(
  "/",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
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
  },
);

// --- 2. GET LIBRARIES (Filtered by Role) ---
// 🟢 Open to all logged-in users (Students, Owners, Admins)
router.get("/", authMiddleware, async (req, res) => {
  try {
    let filter = {};

    if (req.user.role === "Student") {
      filter = { status: "Approved" };
    } else if (req.user.role === "LibraryOwner") {
      filter = { owner_id: req.user.id };
    }

    let query = Library.find(filter);

    if (req.user.role !== "LibraryOwner") {
      query = query.populate("owner_id", "name email");
    }

    // 👇 OPTIMIZED: Added .lean() to convert heavy Mongoose docs to pure JSON
    const libraries = await query.lean();

    res.json(libraries);
  } catch (err) {
    res.status(500).json({ message: "Server error fetching libraries." });
  }
});

// --- 3. SUPERADMIN: APPROVE/REJECT LIBRARY ---
// 🔒 Secured: Only SuperAdmins
router.put(
  "/:id/status",
  authMiddleware,
  authorizeRoles("SuperAdmin"),
  async (req, res) => {
    try {
      const { status } = req.body; // 'Approved' or 'Rejected'
      const library = await Library.findByIdAndUpdate(
        req.params.id,
        { status },
        { new: true },
      );

      res.json({ message: `Library has been ${status}!`, library });
    } catch (err) {
      res
        .status(500)
        .json({ message: "Server error updating library status." });
    }
  },
);

// --- 4. SUPERADMIN: NUCLEAR DELETE (Library, Seats, AND Owner) ---
// 🔒 Secured: Only SuperAdmins
router.delete(
  "/:id",
  authMiddleware,
  authorizeRoles("SuperAdmin"),
  async (req, res) => {
    try {
      const libraryId = req.params.id;
      const libraryToDelete = await Library.findById(libraryId);

      if (!libraryToDelete)
        return res.status(404).json({ message: "Library not found." });

      // 👇 OPTIMIZED: Execute all 3 destructive operations in parallel
      const deletePromises = [
        Library.findByIdAndDelete(libraryId), // Destroy the Library itself
        Enrollment.deleteMany({ library_id: libraryId }), // Destroy all Student Seats
      ];

      // Destroy the Owner's User Account (Frees up the email!)
      if (libraryToDelete.owner_id) {
        deletePromises.push(User.findByIdAndDelete(libraryToDelete.owner_id));
      }

      await Promise.all(deletePromises);

      res.json({
        message:
          "Total Wipe Complete: Library, Seats, and Owner account have been erased.",
      });
    } catch (err) {
      res.status(500).json({ message: "Server error deleting library data." });
    }
  },
);

// --- 5. STUDENT: ADD A REVIEW ---
// 🔒 Secured: Only Students
router.post(
  "/:id/reviews",
  authMiddleware,
  authorizeRoles("Student"),
  async (req, res) => {
    try {
      const { rating, comment } = req.body;

      // 👇 OPTIMIZED: Fetch the library and the user data simultaneously
      const [library, user] = await Promise.all([
        Library.findById(req.params.id),
        require("../models/User").findById(req.user.id),
      ]);

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
  },
);

// --- 6. GET SEAT STATUS FOR A LIBRARY ---
// 🟢 Open to all logged-in users
router.get("/:id/seat-status", authMiddleware, async (req, res) => {
  try {
    const Enrollment = require("../models/Enrollment");
    const Library = require("../models/Library");

    // 👇 OPTIMIZED: Fetch Enrollments and Library settings perfectly in parallel
    const [activeRequests, library] = await Promise.all([
      Enrollment.find({
        library_id: req.params.id,
        status: { $in: ["Pending", "Active"] },
      })
        .select("seat_number")
        .lean(),
      Library.findById(req.params.id).select("blocked_seats").lean(),
    ]);

    const bookedSeats = activeRequests
      .map((req) => req.seat_number)
      .filter(Boolean);

    res.json({
      booked: bookedSeats,
      blocked: library?.blocked_seats || [],
    });
  } catch (err) {
    res.status(500).json({ message: "Server error getting seat status." });
  }
});

// --- 7. OWNER: TOGGLE SEAT BLOCK STATUS ---
// 🔒 Secured: Only Library Owners
router.post(
  "/:id/seats/block",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const { seat_number } = req.body;
      const library = await Library.findById(req.params.id);

      if (!library)
        return res.status(404).json({ message: "Library not found." });

      // Ownership Check
      const currentUserId = req.user.id || req.user._id;
      if (library.owner_id.toString() !== currentUserId.toString()) {
        return res
          .status(403)
          .json({ error: "Unauthorized. Only the owner can do this." });
      }

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
  },
);

// --- 8. OWNER: WALK-IN ASSIGNMENTS ---
// 🔒 Secured: Only Library Owners
router.post(
  "/:id/walk-in",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { seat_number, student_name, student_phone, duration_days } =
        req.body;

      // 1. Find the library
      const library = await Library.findById(id);
      if (!library) {
        return res.status(404).json({ error: "Library not found" });
      }

      // 2. Ownership Check
      const currentUserId = req.user.id || req.user._id;
      if (library.owner_id.toString() !== currentUserId.toString()) {
        return res
          .status(403)
          .json({ error: "Unauthorized. Only the owner can do this." });
      }

      // 3. Validation: Check if seat is blocked
      if (library.blocked_seats.includes(seat_number)) {
        return res.status(400).json({ error: "Cannot assign a blocked seat." });
      }

      // 4. Validation: Check if seat is already occupied in the new or old system
      const isOccupied = library.seat_allocations.some(
        (seat) => seat.seat_number === seat_number,
      );
      const isLegacyBooked =
        library.booked_seats && library.booked_seats.includes(seat_number);

      if (isOccupied || isLegacyBooked) {
        return res.status(400).json({ error: "Seat is already occupied." });
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
        booking_type: "Walk-In",
      };

      // 7. Save to the new array
      library.seat_allocations.push(newAllocation);

      // Keep your existing frontend grid working by adding the seat to the old array too
      if (!library.booked_seats) library.booked_seats = [];
      library.booked_seats.push(seat_number);

      await library.save();

      res.status(200).json({
        message: "Walk-In assigned successfully!",
        allocation: newAllocation,
      });
    } catch (error) {
      console.error("Walk-In Error:", error);
      res.status(500).json({ error: "Server error assigning seat" });
    }
  },
);

// --- 9. OWNER: GET ALL ACTIVE MEMBERS ---
// 🔒 Secured: Only Library Owners
router.get(
  "/:id/members",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      // 👇 OPTIMIZED: Only fetch what we need and lean it out
      const library = await Library.findById(req.params.id)
        .select("owner_id seat_allocations")
        .lean();

      if (!library) {
        return res.status(404).json({ error: "Library not found" });
      }

      const currentUserId = req.user.id || req.user._id;
      if (library.owner_id.toString() !== currentUserId.toString()) {
        return res.status(403).json({ error: "Unauthorized to view members." });
      }

      res.status(200).json(library.seat_allocations || []);
    } catch (error) {
      console.error("Fetch Members Error:", error);
      res.status(500).json({ error: "Server error fetching members" });
    }
  },
);

// --- 10. OWNER: CHECKOUT / EVICT STUDENT ---
// 🔒 Secured: Only Library Owners
router.post(
  "/:id/checkout",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const { seat_number } = req.body;

      // 👇 OPTIMIZED: Firing BOTH the Library fetch and Enrollment search simultaneously!
      const [library, activeEnrollment] = await Promise.all([
        Library.findById(req.params.id),
        Enrollment.findOne({
          library_id: req.params.id,
          status: "Active",
          $or: [
            { seat_number: seat_number },
            { seat_number: String(seat_number) },
            { seat_number: Number(seat_number) },
          ],
        }),
      ]);

      if (!library) {
        return res.status(404).json({ error: "Library not found" });
      }

      // Ownership Check
      const currentUserId = req.user.id || req.user._id;
      if (library.owner_id.toString() !== currentUserId.toString()) {
        return res
          .status(403)
          .json({ error: "Unauthorized. Only the owner can do this." });
      }

      // Check if we found the active app user from the parallel query
      if (activeEnrollment) {
        // 👇 Mirroring the Student Cancel route: Completely delete the record!
        await Enrollment.findByIdAndDelete(activeEnrollment._id);

        // Decrement the Global Occupancy Counter
        if (library.occupied_seats > 0) {
          library.occupied_seats -= 1;
        }
      }

      // Keep existing logic to clean up Walk-Ins
      library.seat_allocations = library.seat_allocations.filter(
        (seat) => String(seat.seat_number) !== String(seat_number),
      );

      if (library.booked_seats) {
        library.booked_seats = library.booked_seats.filter(
          (num) => String(num) !== String(seat_number),
        );
      }

      await library.save();
      res.status(200).json({ message: "Seat checked out successfully" });
    } catch (error) {
      console.error("Checkout Error:", error);
      res.status(500).json({ error: "Server error during checkout" });
    }
  },
);

// --- 11. OWNER: UPDATE PRICING SETTINGS ---
// 🔒 Secured: Only Library Owners
router.put(
  "/:id/settings",
  authMiddleware,
  authorizeRoles("LibraryOwner"),
  async (req, res) => {
    try {
      const { monthly_rate, razorpay_key_id, razorpay_key_secret } = req.body;
      const library = await Library.findById(req.params.id);

      if (!library) {
        return res.status(404).json({ error: "Library not found" });
      }

      // Ownership Check
      const currentUserId = req.user.id || req.user._id;
      if (library.owner_id.toString() !== currentUserId.toString()) {
        return res.status(403).json({
          error: "Unauthorized. Only the library owner can update settings.",
        });
      }

      // Apply updates with fallback defaults
      library.pricing = {
        monthly_rate: Number(monthly_rate) > 0 ? Number(monthly_rate) : 1000,
      };

      library.payment_settings = {
        razorpay_key_id: razorpay_key_id ? razorpay_key_id.trim() : "",
        razorpay_key_secret: razorpay_key_secret
          ? razorpay_key_secret.trim()
          : "",
      };

      await library.save();
      res.status(200).json({ message: "Settings saved successfully", library });
    } catch (error) {
      console.error("Settings Update Error:", error);
      res.status(500).json({ error: "Server error while updating settings" });
    }
  },
);

// Save 2D Floor Plan Blueprint
router.put("/:id/blueprint", authMiddleware, async (req, res) => {
  try {
    const { floor_plan, total_seats } = req.body;

    // Find the library
    const library = await Library.findById(req.params.id);
    if (!library) {
      return res.status(404).json({ error: "Library not found" });
    }

    // Security check: Only the owner or a SuperAdmin can edit the blueprint
    if (
      library.owner_id.toString() !== req.user.id &&
      req.user.role !== "SuperAdmin"
    ) {
      return res
        .status(403)
        .json({ error: "Unauthorized to edit this blueprint" });
    }

    // Update the layout and automatically sync the total capacity
    library.floor_plan = floor_plan;
    if (total_seats !== undefined) {
      library.total_seats = total_seats;
    }

    await library.save();

    res.status(200).json({
      message: "Blueprint saved successfully",
      library,
    });
  } catch (error) {
    console.error("Error saving blueprint:", error);
    res.status(500).json({ error: "Server error saving blueprint" });
  }
});

module.exports = router;
