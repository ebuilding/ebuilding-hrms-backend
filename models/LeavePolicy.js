import mongoose from "mongoose";

const leavePolicySchema = new mongoose.Schema(
  {
    scope: { type: String, required: true, unique: true, default: "COMPANY" },
    annualPaidDays: { type: Number, required: true, min: 0 },
    yearStartMonth: { type: Number, required: true, min: 1, max: 12 },
    yearStartDay: { type: Number, required: true, min: 1, max: 31 },
    grantFrequency: {
      type: String,
      enum: ["MONTHLY", "QUARTERLY", "ANNUAL"],
      required: true,
    },
    newHireCutoffDay: { type: Number, required: true, min: 1, max: 31 },
    carryForwardEnabled: { type: Boolean, default: false },
    activatedAt: { type: Date, required: true },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

const LeavePolicy =
  mongoose.models.LeavePolicy ||
  mongoose.model("LeavePolicy", leavePolicySchema);

export default LeavePolicy;
