import { Router } from "express";
import { protect, protectAdmin } from "../middleware/auth.js";
import {
  clockInOut,
  getAttendance,
  adminClockInOut,
  getAdminTodayAttendance,
  getAttendanceStats,
  getTodayAttendance,
  exportMonthlyAttendance,
} from "../controllers/attendanceController.js";

const attendanceRouter = Router();

attendanceRouter.post("/", protect, clockInOut);
attendanceRouter.post("/history", protect, getAttendance);
attendanceRouter.get(
  "/admin/:employeeId/today",
  protect,
  protectAdmin,
  getAdminTodayAttendance,
);
attendanceRouter.post(
  "/admin/export",
  protect,
  protectAdmin,
  exportMonthlyAttendance,
);
attendanceRouter.post(
  "/admin/:employeeId",
  protect,
  protectAdmin,
  adminClockInOut,
);

attendanceRouter.get("/stats/trend", protect, getAttendanceStats);
attendanceRouter.get("/today", protect, getTodayAttendance);

attendanceRouter.get("/run-cron", async (req, res) => {
  try {
    const { runAttendanceCron } = await import("../cron/attendanceCron.js");
    await runAttendanceCron();
    res.json({ success: true, message: "Cron job executed successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default attendanceRouter;
