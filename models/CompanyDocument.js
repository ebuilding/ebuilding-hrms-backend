import mongoose from "mongoose";

const companyDocumentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    fileUrl: {
      type: String,
      required: true, // E.g., S3 or local upload path
    },
    requiresSignature: {
      type: Boolean,
      default: false,
    },
    version: {
      type: String,
      default: "1.0",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("CompanyDocument", companyDocumentSchema);
