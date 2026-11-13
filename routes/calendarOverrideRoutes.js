import express from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  getCalendarOverrides,
  createCalendarOverride,
  deleteCalendarOverride,
  syncCalendarOverridesWithLeavesController,
} from "../controllers/calendarOverrideController.js";

const router = express.Router();

// GET /api/calendar-overrides?year=YYYY (Authenticated users)
router.get("/", protect, getCalendarOverrides);

// POST /api/calendar-overrides (Admin only)
router.post("/", protect, protectAdmin, createCalendarOverride);

// POST /api/calendar-overrides/sync-leaves (Admin only)
router.post("/sync-leaves", protect, protectAdmin, syncCalendarOverridesWithLeavesController);

// DELETE /api/calendar-overrides/:id (Admin only)
router.delete("/:id", protect, protectAdmin, deleteCalendarOverride);

export default router;
