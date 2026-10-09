import { Router } from "express";
import {
  createEmployee,
  deleteEmployee,
  getEmployees,
  updateEmployee,
  getEmployeeById,
} from "../controllers/employeeController.js";
import {
  protect,
  protectAdmin,
  protectAdminOrSecurity,
} from "../middleware/auth.js";

const employeesRouter = Router();

employeesRouter.get("/", protect, protectAdminOrSecurity, getEmployees);
employeesRouter.get("/:id", protect, protectAdmin, getEmployeeById);
employeesRouter.post("/", protect, protectAdmin, createEmployee);
employeesRouter.put("/:id", protect, protectAdmin, updateEmployee);
employeesRouter.delete("/:id", protect, protectAdmin, deleteEmployee);

export default employeesRouter;
