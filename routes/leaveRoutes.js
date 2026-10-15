import { Router } from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  createLeave,
  getLeaves,
  updateLeaveStatus,
  adminCreateLeave,
  getOnLeaveToday,
  getLeaveCalendar,
} from "../controllers/leaveController.js";

const leaveRouter = Router();

leaveRouter.get("/today", protect, protectAdmin, getOnLeaveToday);
leaveRouter.get("/calendar", protect, getLeaveCalendar);
leaveRouter.post("/", protect, createLeave);
leaveRouter.post("/admin", protect, protectAdmin, adminCreateLeave);
leaveRouter.get("/", protect, getLeaves);
leaveRouter.patch("/:id", protect, protectAdmin, updateLeaveStatus);

export default leaveRouter;
