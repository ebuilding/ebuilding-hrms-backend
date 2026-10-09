import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    position: { type: String, required: true },
    shiftHours: { type: Number, default: 0 },
    basicSalary: { type: Number, default: 0 },
    allowances: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    employmentStatus: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
    joinDate: { type: Date, required: true },
    isDeleted: { type: Boolean, default: false },
    bio: { type: String, default: "" },
    profile_img: { type: String, default: "" },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
    },
    leaveBalance: {
      paid: { type: Number, default: 0 },
      compOff: { type: Number, default: 0 },
      lastYearRemaining: { type: Number, default: 0 },
    },
    bankDetails: {
      accountHolderName: { type: String, default: "" },
      accountNumber: { type: String, default: "" },
      bankName: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      branchName: { type: String, default: "" },
    },
    personalInfo: {
      dob: { type: Date },
      gender: {
        type: String,
        enum: ["MALE", "FEMALE", "OTHER"],
        default: "MALE",
      },
      maritalStatus: {
        type: String,
        enum: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"],
        default: "SINGLE",
      },
      address: {
        resident: { type: String, default: "" },
        permanent: { type: String, default: "" },
      },
    },
    education: [
      {
        degree: { type: String },
        institution: { type: String },
        year: { type: String },
        percentage: { type: String },
      },
    ],
    documents: [
      {
        name: { type: String },
        url: { type: String },
        uploadDate: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

const Employee =
  mongoose.models.Employee || mongoose.model("Employee", employeeSchema);

export default Employee;
