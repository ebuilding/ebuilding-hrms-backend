import { Router } from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  createLeave,
  getLeaves,
  updateLeaveStatus,
  adminCreateLeave,
  getOnLeaveToday,
  getLeaveCalendar,
  calculateLeaveDays,
  editPendingLeave,
  deletePendingLeave,
  requestRevokeLeave,
  processRevokeLeave,
} from "../controllers/leaveController.js";

const leaveRouter = Router();

leaveRouter.get("/today", protect, protectAdmin, getOnLeaveToday);
leaveRouter.get("/calendar", protect, getLeaveCalendar);
leaveRouter.get("/calculate-days", protect, calculateLeaveDays);
leaveRouter.post("/", protect, createLeave);
leaveRouter.post("/admin", protect, protectAdmin, adminCreateLeave);
leaveRouter.get("/", protect, getLeaves);
leaveRouter.patch("/:id", protect, protectAdmin, updateLeaveStatus);
leaveRouter.put("/:id", protect, editPendingLeave);
leaveRouter.delete("/:id", protect, deletePendingLeave);
leaveRouter.post("/:id/revoke-request", protect, requestRevokeLeave);
leaveRouter.patch("/:id/revoke", protect, protectAdmin, processRevokeLeave);

export default leaveRouter;

