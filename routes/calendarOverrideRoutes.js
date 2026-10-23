import express from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  getCalendarOverrides,
  createCalendarOverride,
  deleteCalendarOverride,
} from "../controllers/calendarOverrideController.js";

const router = express.Router();

// GET /api/calendar-overrides?year=YYYY (Authenticated users)
router.get("/", protect, getCalendarOverrides);

// POST /api/calendar-overrides (Admin only)
router.post("/", protect, protectAdmin, createCalendarOverride);

// DELETE /api/calendar-overrides/:id (Admin only)
router.delete("/:id", protect, protectAdmin, deleteCalendarOverride);

export default router;
