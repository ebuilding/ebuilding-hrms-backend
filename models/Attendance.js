import mongoose from "mongoose";
import { AttendanceStatus, DayType } from "../constants/enums.js";

const attendanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    date: { type: Date, required: true },
    checkIn: { type: Date, default: null },
    checkOut: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(AttendanceStatus),
      default: AttendanceStatus.NOT_MARKED,
    },
    workingHours: { type: Number, default: null },
    dayType: {
      type: String,
      enum: [...Object.values(DayType), null],
      default: null,
    },
    compoffFor: { type: String, default: null },
    compOffCredited: { type: Boolean, default: false },
    updatedBy: { type: String, default: null },
    adminUpdatedAt: { type: Date, default: null },
    isDirectAdminLeave: { type: Boolean, default: false },
  },
  { timestamps: true },
);

attendanceSchema.index({ employeeId: 1, date: 1 }, { unique: true });

const Attendance =
  mongoose.models.Attendance || mongoose.model("Attendance", attendanceSchema);

export default Attendance;
