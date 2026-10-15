import express from "express";
import cors from "cors";
import "dotenv/config";
import multer from "multer";
import connectDB from "./config/db.js";
import authRouter from "./routes/authRoutes.js";
import employeesRouter from "./routes/employeeRoutes.js";
import profileRouter from "./routes/profileRoutes.js";
import attendanceRouter from "./routes/attendanceRoutes.js";
import leaveRouter from "./routes/leaveRoutes.js";
import payslipRouter from "./routes/payslipsRoutes.js";
import dashboardRouter from "./routes/dashboardRoutes.js";
import holidayRouter from "./routes/holidayRoutes.js";
import configRouter from "./routes/configRoutes.js";
import departmentRouter from "./routes/departmentRoutes.js";
import uploadRouter from "./routes/uploadRoutes.js";
import taskSheetRouter from "./routes/taskSheetRoutes.js";
import leavePolicyRouter from "./routes/leavePolicyRoutes.js";
import documentRouter from "./routes/documentRoutes.js";
import inviteRouter from "./routes/inviteRoutes.js";
import compOffRouter from "./routes/compOffRoutes.js";

import { serve } from "inngest/express";
import { inngest, functions } from "./inngest/index.js";
import { startAttendanceCron } from "./cron/attendanceCron.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Trust reverse proxy headers (Nginx on EC2, Cloudflare, AWS ALB, etc.)
app.set("trust proxy", true);

// Middleware
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// Routes
app.get("/", (req, res) => res.send("Server is running"));
app.use("/api/auth", authRouter);
app.use("/api/invites", inviteRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/profile", profileRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/leave", leaveRouter);
app.use("/api/payslips", payslipRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/holidays", holidayRouter);
app.use("/api/config", configRouter);
app.use("/api/departments", departmentRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/tasksheet", taskSheetRouter);
app.use("/api/leave-policy", leavePolicyRouter);
app.use("/api/documents", documentRouter);
app.use("/api/compoff", compOffRouter);

app.use("/api/inngest", serve({ client: inngest, functions }));

// Global error handling middleware (prevents unhandled route crashes)
app.use((err, req, res, next) => {
  console.error("Express Error Handler:", err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// Process-level error protection to prevent Node process termination on EC2
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

const startServer = async () => {
  try {
    await connectDB();
    startAttendanceCron();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

startServer();
