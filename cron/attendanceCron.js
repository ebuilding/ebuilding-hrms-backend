import cron from "node-cron";
import moment from "moment-timezone";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import Config from "../models/Config.js";
import CronLog from "../models/CronLog.js";
import Holiday from "../models/Holiday.js";
import CalendarOverride from "../models/CalendarOverride.js";
import { getCalendarDaySchedule } from "../utils/calendarSchedule.js";
import { AttendanceStatus } from "../constants/enums.js";
import { sendDailyAutomatedCelebrationWishes } from "../utils/celebrations.js";
import {
  getAttendanceShiftConfig,
  determineAttendanceDayType,
  getShiftEndMoment,
} from "../utils/shiftConfig.js";

const TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Kolkata";
const SCHEDULE = process.env.ATTENDANCE_CRON_SCHEDULE || "30 0 * * *";

const normalizeDate = (value) => {
  return moment.tz(value, TIMEZONE).startOf("day").toDate();
};

const autoPunchOutMissedCheckouts = async (todayStart, logDetails) => {
  try {
    const unclosedRecords = await Attendance.find({
      date: { $lt: todayStart },
      checkIn: { $ne: null },
      checkOut: null,
    });

    const shiftConfig = await getAttendanceShiftConfig();

    for (const record of unclosedRecords) {
      try {
        const checkInMoment = moment(record.checkIn).tz(TIMEZONE);
        let checkOutMoment = getShiftEndMoment(checkInMoment, shiftConfig);

        if (checkOutMoment.isSameOrBefore(checkInMoment)) {
          checkOutMoment.add(1, "day");
        }

        record.checkOut = checkOutMoment.toDate();
        const duration = Math.max(
          0,
          (record.checkOut - record.checkIn) / (1000 * 60 * 60),
        );
        record.workingHours = parseFloat(duration.toFixed(2));
        const { dayType } = determineAttendanceDayType(
          record.workingHours,
          shiftConfig,
        );
        record.dayType = dayType;
        record.status = AttendanceStatus.PRESENT;
        record.updatedBy = "System";
        record.adminUpdatedAt = new Date();
        await record.save();

        logDetails.push({
          attendanceId: record._id,
          employeeId: record.employeeId,
          action: "UPDATED",
          status: AttendanceStatus.PRESENT,
          reason: `Auto punch-out for missed checkout at ${shiftConfig.endTime || "07:00 PM"}`,
        });
      } catch (err) {
        logDetails.push({
          attendanceId: record._id,
          employeeId: record.employeeId,
          action: "FAILED",
          error: `Auto punch-out failed: ${err.message}`,
        });
      }
    }
  } catch (err) {
    console.error("Error in autoPunchOutMissedCheckouts:", err);
  }
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

  const todayEnd = moment.tz(todayStart, TIMEZONE).endOf("day").toDate();
  const [holidays, config, overrides] = await Promise.all([
    Holiday.find({ date: { $gte: todayStart, $lte: todayEnd } }).lean(),
    Config.findOne({ key: "weekOffDays" }).lean(),
    CalendarOverride.find({
      $or: [
        { date: { $gte: todayStart, $lte: todayEnd } },
        { swapDate: { $gte: todayStart, $lte: todayEnd } },
      ],
    }).lean(),
  ]);

  const schedule = getCalendarDaySchedule(todayStart, {
    overrides,
    holidays,
    weekOffConfig: config?.value,
    timezone: TIMEZONE,
  });

  const status = schedule.isHoliday
    ? "HOLIDAY"
    : schedule.isWeekOff
      ? "WEEK_OFF"
      : "NOT_MARKED";

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
        await Attendance.create({
          employeeId: employee._id,
          date: todayStart,
          status,
        });
        detail.action = "CREATED";
        detail.status = status;
        detail.reason = schedule.label || (schedule.isWorkingDay ? "Standard Work Day" : "Company Off");
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

    // Auto punch-out missed checkouts from yesterday or past days
    await autoPunchOutMissedCheckouts(todayStart, logDetails);
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
    try {
      cronLog.endTime = new Date();
      await cronLog.save();
      console.log(`Attendance cron finished. Status: ${cronLog.status}`);
    } catch (saveErr) {
      console.error("Failed to save cronLog:", saveErr);
    }
  }
};

export const startCelebrationsCron = () => {
  cron.schedule(
    "0 9 * * *",
    async () => {
      try {
        console.log("Daily celebrations wish cron starting...");
        const res = await sendDailyAutomatedCelebrationWishes();
        console.log("Celebrations wish cron finished:", res);
      } catch (err) {
        console.error("Error in celebrations wish cron:", err);
      }
    },
    {
      timezone: TIMEZONE,
    },
  );
  console.log(`Celebrations wish cron scheduled: 0 9 * * * (${TIMEZONE})`);
};

export const startAttendanceCron = () => {
  cron.schedule(
    SCHEDULE,
    async () => {
      try {
        console.log("Attendance cron starting...");
        await runAttendanceCron();
      } catch (err) {
        console.error("Error in attendance cron execution:", err);
      }
    },
    {
      timezone: TIMEZONE,
    },
  );
  console.log(`Attendance cron scheduled: ${SCHEDULE} (${TIMEZONE})`);
  startCelebrationsCron();
};
