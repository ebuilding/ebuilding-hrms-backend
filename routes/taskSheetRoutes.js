import express from "express";
import { protect } from "../middleware/auth.js";
import {
  getTaskSheet,
  addTask,
  removeTask,
  toggleCompletion,
  addDailyTodo,
  toggleDailyTodo,
  removeDailyTodo,
  submitEodReport,
} from "../controllers/taskSheetController.js";

const router = express.Router();

router.use(protect);

router.get("/", getTaskSheet);
router.post("/task", addTask);
router.delete("/task/:month/:taskId", removeTask);
router.post("/toggle", toggleCompletion);

// Daily To-dos
router.post("/daily-todo", addDailyTodo);
router.post("/daily-todo/toggle", toggleDailyTodo);
router.delete("/daily-todo/:month/:todoId", removeDailyTodo);

// EOD Report
router.post("/eod", submitEodReport);

export default router;
