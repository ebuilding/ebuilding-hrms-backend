import mongoose from "mongoose";
import { CalendarOverrideType } from "../constants/enums.js";

const affectedLeaveSchema = new mongoose.Schema(
  {
    leaveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveApplication",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    employeeName: { type: String, default: "" },
    employeeEmail: { type: String, default: "" },
    leaveType: { type: String, required: true },
    refundedDays: { type: Number, default: 0 },
    previousStatus: { type: String, default: "APPROVED" },
  },
  { _id: false },
);

const calendarOverrideSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(CalendarOverrideType),
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
    },
    swapDate: {
      type: Date,
      default: null,
    },
    affectedLeaves: {
      type: [affectedLeaveSchema],
      default: [],
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },
    createdBy: {
      type: String,
      default: "Admin",
    },
  },
  { timestamps: true },
);

calendarOverrideSchema.index({ date: 1, year: 1 });
calendarOverrideSchema.index({ swapDate: 1, year: 1 });

const CalendarOverride =
  mongoose.models.CalendarOverride ||
  mongoose.model("CalendarOverride", calendarOverrideSchema);

export default CalendarOverride;
