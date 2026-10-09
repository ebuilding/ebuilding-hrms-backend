import { Router } from "express";
import {
  getLeavePolicy,
  saveLeavePolicy,
} from "../controllers/leavePolicyController.js";
import { protect, protectAdmin } from "../middleware/auth.js";

const leavePolicyRouter = Router();

leavePolicyRouter.use(protect, protectAdmin);
leavePolicyRouter.get("/", getLeavePolicy);
leavePolicyRouter.put("/", saveLeavePolicy);

export default leavePolicyRouter;
