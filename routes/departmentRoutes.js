import { Router } from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  getDepartments,
  getPublicDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "../controllers/departmentController.js";

const departmentRouter = Router();

departmentRouter.get("/public", getPublicDepartments);
departmentRouter.get("/", protect, getDepartments);
departmentRouter.post("/", protect, protectAdmin, createDepartment);
departmentRouter.put("/:id", protect, protectAdmin, updateDepartment);
departmentRouter.delete("/:id", protect, protectAdmin, deleteDepartment);

export default departmentRouter;
