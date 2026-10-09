import cron from "node-cron";
import moment from "moment-timezone";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import Config from "../models/Config.js";
import CronLog from "../models/CronLog.js";
import { isWeekOffDate } from "../utils/weekOff.js";
import { findHolidayForDate } from "../utils/holiday.js";

const TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Kolkata";
const SCHEDULE = process.env.ATTENDANCE_CRON_SCHEDULE || "30 0 * * *";

const normalizeDate = (value) => {
  return moment.tz(value, TIMEZONE).startOf("day").toDate();
};

const markYesterdayAbsent = async (todayStart, activeEmployees, logDetails) => {
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const employeeIds = activeEmployees.map((employee) => employee._id);
  const yesterdayRecords = await Attendance.find({
    employeeId: { $in: employeeIds },
    date: yesterdayStart,
  });

  const existingYesterdayMap = new Map(
    yesterdayRecords.map((record) => [record.employeeId.toString(), record]),
  );

  for (const employee of activeEmployees) {
    const existingYesterday = existingYesterdayMap.get(employee._id.toString());
    const detail = {
      employeeId: employee._id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      action: "SKIPPED",
      status: "",
      reason: "",
    };

    try {
      if (!existingYesterday) {
        await Attendance.create({
          employeeId: employee._id,
          date: yesterdayStart,
          status: "LEAVE",
        });
        detail.action = "CREATED";
        detail.status = "LEAVE";
        detail.reason = "No attendance record found for yesterday";
      } else if (
        !existingYesterday.checkIn &&
        ["NOT_MARKED", "PENDING"].includes(existingYesterday.status)
      ) {
        existingYesterday.status = "LEAVE";
        await existingYesterday.save();
        detail.action = "UPDATED";
        detail.status = "LEAVE";
        detail.reason = "Employee did not check in";
      } else {
        detail.reason = "Already has status: " + existingYesterday.status;
      }
    } catch (err) {
      detail.action = "FAILED";
      detail.error = err.message;
    }
    logDetails.push(detail);
  }
};

const createTodayPlaceholders = async (
  todayStart,
  activeEmployees,
  logDetails,
) => {
  const employeeIds = activeEmployees.map((employee) => employee._id);
  const todayRecords = await Attendance.find({
    employeeId: { $in: employeeIds },
    date: todayStart,
  });

  const existingTodayMap = new Map(
    todayRecords.map((record) => [record.employeeId.toString(), record]),
  );

  const holiday = await findHolidayForDate(todayStart, TIMEZONE);
  const config = await Config.findOne({ key: "weekOffDays" });
  const dayName = moment(todayStart).tz(TIMEZONE).format("dddd");
  const isWeekOff = isWeekOffDate(todayStart, config?.value, TIMEZONE);

  for (const employee of activeEmployees) {
    const existingToday = existingTodayMap.get(employee._id.toString());
    const detail = {
      employeeId: employee._id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      action: "SKIPPED",
      status: "",
      reason: "",
    };

    try {
      if (!existingToday) {
        const status = holiday
          ? "HOLIDAY"
          : isWeekOff
            ? "WEEK_OFF"
            : "NOT_MARKED";
        await Attendance.create({
          employeeId: employee._id,
          date: todayStart,
          status,
        });
        detail.action = "CREATED";
        detail.status = status;
        detail.reason = holiday
          ? `Public Holiday: ${holiday.name}`
          : isWeekOff
            ? `Weekly Off: ${dayName}`
            : "Standard Work Day";
      } else {
        detail.reason = "Record already exists";
      }
    } catch (err) {
      detail.action = "FAILED";
      detail.error = err.message;
    }
    logDetails.push(detail);
  }
};

export const runAttendanceCron = async () => {
  const startTime = new Date();
  const logDetails = [];
  const cronLog = new CronLog({
    jobName: "Daily Attendance Automation",
    startTime,
  });

  try {
    const todayStart = normalizeDate(new Date());
    const activeEmployees = await Employee.find({
      isDeleted: false,
      employmentStatus: "ACTIVE",
    }).lean();

    cronLog.summary.totalEmployees = activeEmployees.length;

    if (activeEmployees.length === 0) {
      cronLog.status = "SUCCESS";
      cronLog.summary.failures = 0;
      cronLog.endTime = new Date();
      await cronLog.save();
      return;
    }

    // Commented out as per user request: No need to mark absent if not marked
    // await markYesterdayAbsent(todayStart, activeEmployees, logDetails);
    await createTodayPlaceholders(todayStart, activeEmployees, logDetails);

    cronLog.details = logDetails;
    cronLog.summary.recordsCreated = logDetails.filter(
      (d) => d.action === "CREATED",
    ).length;
    cronLog.summary.recordsUpdated = logDetails.filter(
      (d) => d.action === "UPDATED",
    ).length;
    cronLog.summary.failures = logDetails.filter(
      (d) => d.action === "FAILED",
    ).length;
    cronLog.status = cronLog.summary.failures > 0 ? "FAILURE" : "SUCCESS";
  } catch (error) {
    cronLog.status = "FAILURE";
    cronLog.error = error.message;
  } finally {
    cronLog.endTime = new Date();
    await cronLog.save();
    console.log(`Attendance cron finished. Status: ${cronLog.status}`);
  }
};

export const startAttendanceCron = () => {
  cron.schedule(
    SCHEDULE,
    async () => {
      console.log("Attendance cron starting...");
      await runAttendanceCron();
    },
    {
      timezone: TIMEZONE,
    },
  );
  console.log(`Attendance cron scheduled: ${SCHEDULE} (${TIMEZONE})`);
};
