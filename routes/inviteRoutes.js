import express from "express";
import {
  createInvite,
  getInvites,
  deleteInvite,
  toggleInviteStatus,
  validateInvite,
  validateCorrectionToken,
  resubmitCorrection,
  approveSubmission,
  rejectSubmission,
  revokeSubmission,
} from "../controllers/inviteController.js";
import { protect, protectAdmin } from "../middleware/auth.js";

const router = express.Router();

// Public routes for registration and candidate corrections
router.get("/validate/:token", validateInvite);
router.get("/correction/validate/:token", validateCorrectionToken);
router.put("/correction/resubmit/:token", resubmitCorrection);

// Admin-only routes
router.use(protect);
router.use(protectAdmin);

router.post("/", createInvite);
router.get("/", getInvites);
router.delete("/:id", deleteInvite);
router.patch("/:id/toggle-status", toggleInviteStatus);
router.patch("/:inviteId/submissions/:employeeId/approve", approveSubmission);
router.patch("/:inviteId/submissions/:employeeId/reject", rejectSubmission);
router.patch("/:inviteId/submissions/:employeeId/revoke", revokeSubmission);

export default router;
