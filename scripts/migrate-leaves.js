import mongoose from "mongoose";
import dotenv from "dotenv";
import Employee from "../models/Employee.js";

dotenv.config();

const migrate = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB");

    const result = await Employee.updateMany(
      { leaveBalance: { $exists: false } },
      {
        $set: {
          leaveBalance: {
            paid: 12,
            compOff: 0,
            lastYearRemaining: 0,
          },
        },
      },
    );

    console.log(
      `Migration completed. Modified ${result.modifiedCount} employees.`,
    );
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
};

migrate();
