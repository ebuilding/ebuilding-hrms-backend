import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // Native MongoDB TTL index: purges automatically on expiration
    },
    isRevoked: {
      type: Boolean,
      default: false,
    },
    createdByIp: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const RefreshToken =
  mongoose.models.RefreshToken ||
  mongoose.model("RefreshToken", refreshTokenSchema);

export default RefreshToken;
