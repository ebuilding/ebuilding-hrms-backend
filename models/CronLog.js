import mongoose from "mongoose";

const cronLogSchema = new mongoose.Schema(
  {
    jobName: { type: String, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date },
    status: { type: String, enum: ["SUCCESS", "FAILURE"], default: "SUCCESS" },
    summary: {
      totalEmployees: { type: Number, default: 0 },
      recordsCreated: { type: Number, default: 0 },
      recordsUpdated: { type: Number, default: 0 },
      failures: { type: Number, default: 0 },
    },
    details: [
      {
        employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
        employeeName: String,
        action: String, // 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED'
        status: String, // 'PRESENT', 'ABSENT', 'HOLIDAY', 'WEEK_OFF', 'NOT_MARKED'
        reason: String, // 'Holiday - Diwali', 'Missing check-in', 'Already exists', etc.
        error: String,
      },
    ],
    error: String,
  },
  { timestamps: true },
);

const CronLog =
  mongoose.models.CronLog || mongoose.model("CronLog", cronLogSchema);

export default CronLog;
