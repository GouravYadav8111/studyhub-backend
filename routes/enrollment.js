const express = require('express');
const Enrollment = require('../models/Enrollment');
const Library = require('../models/Library');
const authMiddleware = require('../middleware/authMiddleware');
const nodemailer = require('nodemailer');

const router = express.Router();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 1. REQUEST SPECIFIC SEAT
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Student') return res.status(403).json({ message: 'Access Denied.' });
    
    // 👇 UPDATED: Now requires seat_number
    const { library_id, seat_number } = req.body;
    
    if (!seat_number) return res.status(400).json({ message: 'Please select a specific seat from the map.' });

    const library = await Library.findById(library_id);
    if (!library) return res.status(404).json({ message: 'Library not found.' });

    // Check if student already has an active request anywhere
    const existingRequest = await Enrollment.findOne({ student_id: req.user.id, library_id, status: { $ne: 'Completed' } });
    if (existingRequest) return res.status(400).json({ message: 'You already have an active request here.' });

    // 👇 NEW: Check if this exact seat was just snatched by someone else
    const seatTaken = await Enrollment.findOne({ library_id, seat_number, status: { $in: ['Pending', 'Active'] } });
    if (seatTaken) return res.status(400).json({ message: `Seat ${seat_number} was just booked by someone else!` });

    const newEnrollment = new Enrollment({ student_id: req.user.id, library_id, seat_number });
    await newEnrollment.save();
    res.status(201).json({ message: `Seat ${seat_number} requested successfully!`, enrollment: newEnrollment });
  } catch (err) { res.status(500).json({ message: 'Server error.' }); }
});

// --- 2. STUDENT: GET MY REQUESTS ---
router.get('/my-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Student') return res.status(403).json({ message: 'Access Denied.' });
    
    const enrollments = await Enrollment.find({ student_id: req.user.id })
                                        .populate('library_id', 'name location');
    res.json(enrollments);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching your bookings.' });
  }
});

// --- 3. OWNER: VIEW PENDING REQUESTS ---
router.get('/owner-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'LibraryOwner') return res.status(403).json({ message: 'Access Denied.' });

    const ownerLibraries = await Library.find({ owner_id: req.user.id });
    const libraryIds = ownerLibraries.map(lib => lib._id);

    const requests = await Enrollment.find({ library_id: { $in: libraryIds } })
                                     .populate('student_id', 'name email')
                                     .populate('library_id', 'name');
    res.json(requests);
  } catch (err) {
    res.status(500).json({ message: 'Server error fetching requests.' });
  }
});

// --- 4. OWNER: APPROVE OR REJECT A SEAT ---
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'LibraryOwner') return res.status(403).json({ message: 'Access Denied.' });

    const { status } = req.body;
    
    const enrollment = await Enrollment.findById(req.params.id)
                                       .populate('student_id', 'name email')
                                       .populate('library_id', 'name location');
                                       
    if (!enrollment) return res.status(404).json({ message: 'Request not found.' });

    if (status === 'Active' && enrollment.status !== 'Active') {
      await Library.findByIdAndUpdate(enrollment.library_id._id, { $inc: { occupied_seats: 1 } });
      
      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: enrollment.student_id.email,
        subject: '🎉 Your Library Seat is Approved!',
        text: `Hello ${enrollment.student_id.name},\n\nYour seat request at ${enrollment.library_id.name} (${enrollment.library_id.location}) has been officially approved.\n\nBest,\nLibrary SaaS Team`
      };
      
      transporter.sendMail(mailOptions).catch(err => console.error("Email failed:", err));
    } 
    else if (status === 'Rejected' && enrollment.status === 'Active') {
      await Library.findByIdAndUpdate(enrollment.library_id._id, { $inc: { occupied_seats: -1 } });
    }

    enrollment.status = status;
    await enrollment.save();

    res.json({ message: `Seat request marked as ${status}`, enrollment });
  } catch (err) {
    res.status(500).json({ message: 'Server error updating status.' });
  }
});

// --- 5. STUDENT: CANCEL OR CHECKOUT (NEW!) ---
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'Student') return res.status(403).json({ message: 'Access Denied.' });

    const enrollment = await Enrollment.findById(req.params.id);
    if (!enrollment) return res.status(404).json({ message: 'Booking not found.' });

    // Security Check: Only the student who made the request can cancel it
    if (enrollment.student_id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to cancel this booking.' });
    }

    // If the seat was already Approved (Active), we must free up the seat in the library!
    if (enrollment.status === 'Active') {
      await Library.findByIdAndUpdate(enrollment.library_id, { $inc: { occupied_seats: -1 } });
    }

    await Enrollment.findByIdAndDelete(req.params.id);

    res.json({ message: 'Booking successfully canceled and seat freed up.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error while canceling booking.' });
  }
});

module.exports = router;