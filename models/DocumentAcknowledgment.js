import mongoose from "mongoose";

const documentAcknowledgmentSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CompanyDocument",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "SIGNED"],
      default: "PENDING",
    },
    signedAt: {
      type: Date,
      default: null,
    },
    signatureText: {
      type: String, // The typed e-signature (e.g., employee's full name)
      default: null,
    },
    ipAddress: {
      type: String, // Useful for basic audit trails
      default: null,
    },
  },
  { timestamps: true }
);

// Prevent an employee from having duplicate acknowledgments for the exact same document
documentAcknowledgmentSchema.index(
  { documentId: 1, employeeId: 1 },
  { unique: true }
);

export default mongoose.model("DocumentAcknowledgment", documentAcknowledgmentSchema);
