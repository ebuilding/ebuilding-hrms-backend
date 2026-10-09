import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import Holiday from "../models/Holiday.js";
import Leave from "../models/LeaveApplication.js";
import TaskSheet, { TaskCompletion, DailyFocus } from "../models/TaskSheet.js";
import moment from "moment-timezone";

const TZ = "Asia/Kolkata";

async function seedTaskSheets() {
  try {
    await connectDB();
    console.log("Connected to Database.");

    // Delete existing records to allow a clean seed
    const monthStr = "2026-05";
    await TaskSheet.deleteMany({ month: monthStr });
    await TaskCompletion.deleteMany({ month: monthStr });
    await DailyFocus.deleteMany({ month: monthStr });
    console.log("Wiped existing May 2026 TaskSheet records for clean seed.");

    const users = await User.find({});
    console.log(`Found ${users.length} users to seed.`);

    // Fetch holidays for May 2026
    const holidays = await Holiday.find({
      date: {
        $gte: new Date("2026-05-01T00:00:00.000Z"),
        $lte: new Date("2026-05-31T23:59:59.999Z"),
      },
    });
    const holidayDates = holidays.map((h) =>
      moment(h.date).tz(TZ).format("YYYY-MM-DD"),
    );

    for (const user of users) {
      console.log(
        `Seeding normalized Task Sheet for User: ${user.email} (${user.role})`,
      );

      // Fetch Employee to check for approved leaves
      let employee = null;
      let leaveDates = [];
      if (user.role === "EMPLOYEE") {
        employee = await Employee.findOne({ userId: user._id });
        if (employee) {
          const leaves = await Leave.find({
            employee: employee._id,
            status: "APPROVED",
            startDate: { $lte: new Date("2026-05-31T23:59:59.999Z") },
            endDate: { $gte: new Date("2026-05-01T00:00:00.000Z") },
          });

          leaves.forEach((leave) => {
            let curr = moment(leave.startDate).tz(TZ);
            const end = moment(leave.endDate).tz(TZ);
            while (curr.isSameOrBefore(end, "day")) {
              leaveDates.push(curr.format("YYYY-MM-DD"));
              curr.add(1, "days");
            }
          });
        }
      }

      // Create the parent monthly sheet document containing recurring routines definitions
      const defaultTasks = [
        { name: "Check Emails & Slack", category: "Admin" },
        { name: "Attend Daily Standup", category: "Meeting" },
        { name: "Perform Code Reviews", category: "Development" },
        { name: "Update Task Board / Jira", category: "Management" },
      ];

      const sheet = await TaskSheet.create({
        userId: user._id,
        month: monthStr,
        tasks: defaultTasks.map((t) => ({
          _id: new mongoose.Types.ObjectId(),
          name: t.name,
          category: t.category,
        })),
        approvalStatus: "PENDING",
      });

      // Seed daily completions & daily focus/EOD reports up to May 17, 2026
      for (let day = 1; day <= 17; day++) {
        const dateStr = `2026-05-${String(day).padStart(2, "0")}`;
        const dayMoment = moment(dateStr, "YYYY-MM-DD").tz(TZ);
        const dayOfWeek = dayMoment.day(); // 0 is Sunday, 6 is Saturday

        // Skip Weekends
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        // Skip Holidays
        if (holidayDates.includes(dateStr)) continue;

        // Skip Leaves
        if (leaveDates.includes(dateStr)) continue;

        // Seed individual task completions in their dedicated lightweight collection
        for (let idx = 0; idx < sheet.tasks.length; idx++) {
          const task = sheet.tasks[idx];
          // ~80% completion rate
          if (idx === 0 || Math.random() > 0.2) {
            await TaskCompletion.create({
              userId: user._id,
              month: monthStr,
              taskId: task._id,
              date: dateStr,
            });
          }
        }

        // Seed daily focus planner & EOD reports in their dedicated daily collection
        const todos = [
          {
            name: `Resolve assigned bug ticket #${100 + day}`,
            completed: true,
          },
          {
            name: `Prepare development updates for ${taskNameSuffix(day)}`,
            completed: Math.random() > 0.15,
          },
        ];

        await DailyFocus.create({
          userId: user._id,
          month: monthStr,
          date: dateStr,
          todos,
          eodReportText: `EOD Status report for ${dateStr}:\n1. Handled all recurring tasks.\n2. Resolved daily focus items.\n3. Assisted teammates during daily sync.\nAll deliverables are up-to-date.`,
          submittedAt: dayMoment.hour(18).minute(30).toDate(),
        });
      }

      console.log(
        `Successfully completed normalized seeding for ${user.email}!`,
      );
    }

    console.log("Normalized seeding process completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Failed to seed normalized task sheets:", error);
    process.exit(1);
  }
}

function taskNameSuffix(day) {
  const modules = [
    "Payroll Integration",
    "Recruitment UI",
    "Asset Management System",
    "Attendance Tracker Rate Refinement",
    "Task Sheet Model",
  ];
  return modules[day % modules.length];
}

seedTaskSheets();
