import express from "express";
import {
  getHolidays,
  addHoliday,
  updateHoliday,
  deleteHoliday,
} from "../controllers/holidayController.js";

const router = express.Router();

// GET /api/holidays?year=2024
router.get("/", getHolidays);

// POST /api/holidays
router.post("/", addHoliday);

// PUT /api/holidays/:id
router.put("/:id", updateHoliday);

// DELETE /api/holidays/:id
router.delete("/:id", deleteHoliday);

export default router;
