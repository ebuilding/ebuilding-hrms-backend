import mongoose from "mongoose";
import { UserRole, ApprovalStatus } from "../constants/enums.js";

const registrationInviteSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    label: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.EMPLOYEE,
    },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    maxUses: {
      type: Number,
      default: null,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    submissions: [
      {
        employeeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
        },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        submittedAt: {
          type: Date,
          default: Date.now,
        },
        approvalStatus: {
          type: String,
          enum: Object.values(ApprovalStatus),
          default: ApprovalStatus.PENDING,
        },
        approvedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
        approvedAt: {
          type: Date,
          default: null,
        },
        rejectionReason: {
          type: String,
          default: "",
        },
      },
    ],
  },
  { timestamps: true },
);

const RegistrationInvite =
  mongoose.models.RegistrationInvite ||
  mongoose.model("RegistrationInvite", registrationInviteSchema);

export default RegistrationInvite;
