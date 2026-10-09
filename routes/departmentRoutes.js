import { Router } from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "../controllers/departmentController.js";

const departmentRouter = Router();

departmentRouter.get("/", protect, getDepartments);
departmentRouter.post("/", protect, protectAdmin, createDepartment);
departmentRouter.put("/:id", protect, protectAdmin, updateDepartment);
departmentRouter.delete("/:id", protect, protectAdmin, deleteDepartment);

export default departmentRouter;
