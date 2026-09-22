const express = require("express");
const router = express.Router();
const Library = require("../models/Library");
const User = require("../models/User");
const protect = require("../middleware/authMiddleware");
const authorizeRoles = require("../middleware/roleMiddleware");

// @route   GET /api/admin/metrics
// @desc    Get platform-wide financial and user metrics
// @access  Private (SuperAdmin only)
router.get("/metrics", protect, authorizeRoles("SuperAdmin"), async (req, res) => {
  try {
    // 1. Calculate Monthly Recurring Revenue (MRR)
    // We only count seats from 'Approved' (actively paying) libraries
    const activeLibraries = await Library.find({ status: "Approved" }).select("total_seats");
    const totalActiveSeats = activeLibraries.reduce((sum, lib) => sum + (lib.total_seats || 0), 0);
    
    // ₹10 per seat is your platform commission/fee
    const mrr = totalActiveSeats * 10; 

    // 2. Fetch Library Status Distribution
    const pendingLibraries = await Library.countDocuments({ status: "Payment_Pending" });
    const abandonedLibraries = await Library.countDocuments({ status: "Abandoned" });

    // 3. Fetch User Demographics
    const totalOwners = await User.countDocuments({ role: "LibraryOwner" });
    const totalStudents = await User.countDocuments({ role: "Student" });

    res.status(200).json({
      success: true,
      data: {
        revenue: {
          mrr: mrr,
          active_seats: totalActiveSeats,
        },
        libraries: {
          active: activeLibraries.length,
          pending: pendingLibraries,
          abandoned: abandonedLibraries,
        },
        users: {
          owners: totalOwners,
          students: totalStudents,
        }
      }
    });
  } catch (error) {
    console.error("Admin Metrics Error:", error);
    res.status(500).json({ error: "Server error fetching financial metrics." });
  }
});

module.exports = router;