import moment from "moment-timezone";
import Attendance from "../models/Attendance.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Holiday from "../models/Holiday.js";
import CalendarOverride from "../models/CalendarOverride.js";
import Config from "../models/Config.js";
import { getCalendarDaySchedule, toDateKey } from "./calendarSchedule.js";
import { AttendanceStatus, DayType, LeaveStatus } from "../constants/enums.js";

const TIMEZONE = "Asia/Kolkata";

/**
 * Restores the baseline state for an employee's attendance record when a punch is deleted.
 * Checks for:
 * 1. Approved Leave -> restores status: "LEAVE" with leave details
 * 2. Company Holiday / Calendar Override -> restores status: "HOLIDAY"
 * 3. Weekly Off -> restores status: "WEEK_OFF"
 * 4. Regular Working Day -> safely removes the record
 *
 * @param {string|mongoose.Types.ObjectId} employeeId - Target employee ID
 * @param {Date|string} date - The date whose punch is being removed
 * @returns {Promise<{ restored: boolean, status?: string, message: string }>}
 */
export const restoreBaselineAttendance = async (employeeId, date) => {
  const targetMoment = moment(date).tz(TIMEZONE);
  const targetDateKey = targetMoment.format("YYYY-MM-DD");
  const targetStart = targetMoment.clone().startOf("day").toDate();
  const targetEnd = targetMoment.clone().endOf("day").toDate();

  // 1. Check if there is an Approved Leave covering this date
  const activeLeave = await LeaveApplication.findOne({
    employeeId,
    status: LeaveStatus.APPROVED,
    startDate: { $lte: targetEnd },
    endDate: { $gte: targetStart },
  }).lean();

  if (activeLeave) {
    // Verify target date was not reverted
    const isReverted =
      Array.isArray(activeLeave.revertedDates) &&
      activeLeave.revertedDates.some(
        (rd) => toDateKey(rd, TIMEZONE) === targetDateKey
      );

    let isActiveDate = !isReverted;
    if (isActiveDate && Array.isArray(activeLeave.workingDates) && activeLeave.workingDates.length > 0) {
      isActiveDate = activeLeave.workingDates.some(
        (wd) => toDateKey(wd, TIMEZONE) === targetDateKey
      );
    }

    if (isActiveDate) {
      // Restore Attendance document to LEAVE
      await Attendance.findOneAndUpdate(
        {
          employeeId,
          date: { $gte: targetStart, $lte: targetEnd },
        },
        {
          $set: {
            employeeId,
            date: targetStart,
            status: AttendanceStatus.LEAVE,
            dayType: activeLeave.isHalfDay ? DayType.HALF_DAY : DayType.FULL_DAY,
            halfDayType: activeLeave.halfDayType || null,
            checkIn: null,
            checkOut: null,
            workingHours: 0,
            isDirectAdminLeave: false,
            notes: activeLeave.reason || "Approved Leave",
            updatedBy: null,
            adminUpdatedAt: null,
          },
        },
        { upsert: true, new: true }
      );

      return {
        restored: true,
        status: AttendanceStatus.LEAVE,
        message: "Attendance restored to approved leave status.",
      };
    }
  }

  // 2. Check Schedule (Holiday, Swap Off, Week-off)
  const [holidays, overrides, weekOffConfigDoc] = await Promise.all([
    Holiday.find({
      date: { $gte: targetStart, $lte: targetEnd },
    }).lean(),
    CalendarOverride.find({
      $or: [
        { date: { $gte: targetStart, $lte: targetEnd } },
        { swapDate: { $gte: targetStart, $lte: targetEnd } },
      ],
    }).lean(),
    Config.findOne({ key: "weekOffDays" }).lean(),
  ]);

  const weekOffConfig = weekOffConfigDoc?.value || { weeklyDays: ["Sunday"] };
  const schedule = getCalendarDaySchedule(targetMoment, {
    overrides,
    holidays,
    weekOffConfig,
    timezone: TIMEZONE,
  });

  if (schedule.isHoliday) {
    await Attendance.findOneAndUpdate(
      {
        employeeId,
        date: { $gte: targetStart, $lte: targetEnd },
      },
      {
        $set: {
          employeeId,
          date: targetStart,
          status: AttendanceStatus.HOLIDAY,
          dayType: DayType.FULL_DAY,
          checkIn: null,
          checkOut: null,
          workingHours: 0,
          notes: schedule.label || "Public Holiday",
          updatedBy: null,
          adminUpdatedAt: null,
        },
      },
      { upsert: true, new: true }
    );
    return {
      restored: true,
      status: AttendanceStatus.HOLIDAY,
      message: "Attendance restored to official holiday status.",
    };
  }

  if (schedule.isSwapOff) {
    await Attendance.findOneAndUpdate(
      {
        employeeId,
        date: { $gte: targetStart, $lte: targetEnd },
      },
      {
        $set: {
          employeeId,
          date: targetStart,
          status: AttendanceStatus.HOLIDAY,
          dayType: DayType.FULL_DAY,
          checkIn: null,
          checkOut: null,
          workingHours: 0,
          notes: schedule.reason ? `Swap Off: ${schedule.reason}` : "Swap Off",
          updatedBy: null,
          adminUpdatedAt: null,
        },
      },
      { upsert: true, new: true }
    );
    return {
      restored: true,
      status: AttendanceStatus.HOLIDAY,
      message: "Attendance restored to swap off status.",
    };
  }

  if (schedule.isWeekOff) {
    await Attendance.findOneAndUpdate(
      {
        employeeId,
        date: { $gte: targetStart, $lte: targetEnd },
      },
      {
        $set: {
          employeeId,
          date: targetStart,
          status: AttendanceStatus.WEEK_OFF,
          dayType: DayType.FULL_DAY,
          checkIn: null,
          checkOut: null,
          workingHours: 0,
          notes: "Weekly Off",
          updatedBy: null,
          adminUpdatedAt: null,
        },
      },
      { upsert: true, new: true }
    );
    return {
      restored: true,
      status: AttendanceStatus.WEEK_OFF,
      message: "Attendance restored to weekly off status.",
    };
  }

  // 3. Regular working day: safely remove the attendance record
  await Attendance.findOneAndDelete({
    employeeId,
    date: { $gte: targetStart, $lte: targetEnd },
  });

  return {
    restored: false,
    message: "Attendance record deleted successfully.",
  };
};
