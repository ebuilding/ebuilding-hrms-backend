import mongoose from "mongoose";
import { CompOffRequestStatus } from "../constants/enums.js";

const compOffRequestSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    attendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Attendance",
      required: true,
      index: true,
    },
    workedDate: {
      type: Date,
      required: true,
    },
    workedHours: {
      type: Number,
      required: true,
    },
    dayType: {
      type: String,
      enum: ["Full Day", "Half Day"],
      required: true,
    },
    creditedDays: {
      type: Number,
      required: true, // 1.0 or 0.5
    },
    compoffFor: {
      type: String,
      enum: ["Week Off", "Holiday", "Other"],
      default: "Week Off",
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(CompOffRequestStatus),
      default: CompOffRequestStatus.PENDING,
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
    },
  },
  { timestamps: true }
);

const CompOffRequest =
  mongoose.models.CompOffRequest ||
  mongoose.model("CompOffRequest", compOffRequestSchema);

export default CompOffRequest;
