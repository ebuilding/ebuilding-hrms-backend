import mongoose from "mongoose";

const punchNonceSchema = new mongoose.Schema(
  {
    nonce: {
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
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

// TTL index to automatically remove expired nonces after 2 minutes
punchNonceSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 120 });
punchNonceSchema.index({ nonce: 1, used: 1 });

const PunchNonce =
  mongoose.models.PunchNonce || mongoose.model("PunchNonce", punchNonceSchema);

export default PunchNonce;

