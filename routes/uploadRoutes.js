import express from "express";
import multer from "multer";
import { protect, protectAdmin } from "../middleware/auth.js";

import { storage } from "../config/cloudinary.js";

const router = express.Router();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// POST /api/upload/document
router.post(
  "/document",
  protect,
  protectAdmin,
  upload.single("document"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    res.json({
      success: true,
      url: req.file.path,
      name: req.file.originalname,
    });
  },
);

// DELETE /api/upload/document
router.delete("/document", protect, protectAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: "File URL is required" });
    }

    // Extract public_id from Cloudinary URL
    // e.g., https://res.cloudinary.com/cloud/image/upload/v12345/ems-documents/filename.jpg
    const parts = url.split("/");
    const filenameWithExt = parts.pop();
    const folder = parts.pop();
    const filename = filenameWithExt.split(".")[0];
    const public_id = `${folder}/${filename}`;

    // Call cloudinary destroy
    const { cloudinary } = await import("../config/cloudinary.js");
    await cloudinary.uploader.destroy(public_id);

    res.json({ success: true, message: "File deleted successfully" });
  } catch (error) {
    console.error("Delete file error:", error);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

export default router;
