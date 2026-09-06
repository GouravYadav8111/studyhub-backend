// middleware/uploadMiddleware.js
const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

// 1. Configure Cloudinary with your .env variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// 2. Set up the storage engine
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "studyhub_images", // Creates a specific folder in your Cloudinary dashboard
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    // Optional: Automatically resize massive images to save bandwidth
    transformation: [{ width: 1200, crop: "limit" }],
  },
});

// 3. Initialize Multer with the Cloudinary storage
const upload = multer({ storage: storage });

module.exports = upload;
