import mongoose from "mongoose";
import dotenv from "dotenv";
import { syncAllCalendarOverridesWithLeaves } from "../utils/leaveReversal.js";

dotenv.config();

const run = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("MONGODB_URI not found in environment variables");
      process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected successfully. Running calendar overrides & leave synchronization...");

    const report = await syncAllCalendarOverridesWithLeaves();

    console.log("\n--- SYNCHRONIZATION REPORT ---");
    console.log(`Reverted off-day leaves (${report.revertedOffLeaves.length}):`);
    report.revertedOffLeaves.forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.employeeName}] - Refunded: ${item.refundedDays} day(s) (${item.leaveType})`);
    });

    console.log(`\nCompensatory working days synced with leaves (${report.syncedWorkLeaves.length}):`);
    report.syncedWorkLeaves.forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.employeeName}] - Added: ${item.addedDays} day(s) (${item.leaveType}) | Status: ${item.status}`);
    });

    console.log("\nAll schedule overrides, compensatory swap shifts, and leaves are now synchronized!\n");
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("Failed to synchronize overrides and leaves:", error);
    process.exit(1);
  }
};

run();

