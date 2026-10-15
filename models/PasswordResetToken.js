import mongoose from "mongoose";

const passwordResetTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    used: {
      type: Boolean,
      default: false,
      index: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    requestIp: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// TTL index to automatically purge expired records after 24 hours
passwordResetTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

const PasswordResetToken =
  mongoose.models.PasswordResetToken ||
  mongoose.model("PasswordResetToken", passwordResetTokenSchema);

export default PasswordResetToken;
