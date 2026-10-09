import mongoose from "mongoose";

const leaveLedgerSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    policyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeavePolicy",
      required: true,
    },
    leaveApplicationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveApplication",
      default: null,
    },
    type: {
      type: String,
      enum: ["OPENING", "GRANT", "RESERVE", "USE", "RELEASE", "EXPIRE"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    balanceChange: { type: Number, required: true },
    effectiveAt: { type: Date, required: true },
    periodKey: { type: String, default: null },
    idempotencyKey: { type: String, required: true, unique: true },
    createdBy: { type: String, default: "System" },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

leaveLedgerSchema.index({ employeeId: 1, effectiveAt: 1 });

const LeaveLedger =
  mongoose.models.LeaveLedger ||
  mongoose.model("LeaveLedger", leaveLedgerSchema);

export default LeaveLedger;
