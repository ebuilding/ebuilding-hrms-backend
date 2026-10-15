import { Router } from "express";
import {
  changePassword,
  login,
  session,
  registerEmployee,
  forgotPassword,
  verifyResetToken,
  resetPassword,
} from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const authRouter = Router();

authRouter.post("/login", login);
authRouter.post("/register-employee", registerEmployee);
authRouter.get("/session", protect, session);
authRouter.post("/change-password", protect, changePassword);

// Password Reset Flow
authRouter.post("/forgot-password", forgotPassword);
authRouter.get("/verify-reset-token", verifyResetToken);
authRouter.post("/reset-password", resetPassword);

export default authRouter;
