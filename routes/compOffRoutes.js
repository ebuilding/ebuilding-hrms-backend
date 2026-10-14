import express from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  getEligibleDays,
  requestCompOff,
  getCompOffRequests,
  approveCompOffRequest,
  rejectCompOffRequest,
} from "../controllers/compOffController.js";

const router = express.Router();

// All comp-off routes require authentication
router.use(protect);

// Employee routes
router.get("/eligible-days", getEligibleDays);
router.post("/request", requestCompOff);

// Shared route (returns all for admin, own for employee)
router.get("/requests", getCompOffRequests);

// Admin review actions
router.patch("/requests/:id/approve", protectAdmin, approveCompOffRequest);
router.patch("/requests/:id/reject", protectAdmin, rejectCompOffRequest);

export default router;
