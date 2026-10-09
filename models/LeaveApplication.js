import mongoose from "mongoose";

const leaveApplicationSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    type: {
      type: String,
      enum: ["PAID", "UNPAID", "COMP_OFF"],
      required: true,
    },
    isHalfDay: { type: Boolean, default: false },
    halfDayType: {
      type: String,
      enum: ["FIRST_HALF", "SECOND_HALF"],
      default: null,
    },
    chargedDays: { type: Number, min: 0, default: null },
    paidPolicyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeavePolicy",
      default: null,
    },
    paidReservedNow: { type: Number, min: 0, default: 0 },
    paidReservedFuture: { type: Number, min: 0, default: 0 },
    paidReservationActive: { type: Boolean, default: false },
    paidReservationVersion: { type: Number, min: 0, default: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    workingDates: { type: [Date], default: undefined },
    reason: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },
    addedBy: { type: String, default: null },
    adminUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const LeaveApplication =
  mongoose.models.LeaveApplication ||
  mongoose.model("LeaveApplication", leaveApplicationSchema);

export default LeaveApplication;
