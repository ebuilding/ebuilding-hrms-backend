import moment from "moment-timezone";
import Config from "../models/Config.js";
import Holiday from "../models/Holiday.js";
import { isWeekOffDate } from "./weekOff.js";
import { DayType, AttendanceStatus } from "../constants/enums.js";

const TZ = "Asia/Kolkata";

export const DEFAULT_SHIFT_CONFIG = {
  startTime: "10:00 AM",
  endTime: "07:00 PM",
  shiftHours: 9,
  graceMinutes: 15,
  minHoursForFullDay: 4,
};

/**
 * Fetches attendance and shift configuration from database, falling back to default 10:00 AM - 07:00 PM
 */
export const getAttendanceShiftConfig = async () => {
  try {
    const config = await Config.findOne({ key: "attendanceShiftConfig" }).lean();
    if (!config || !config.value) {
      return { ...DEFAULT_SHIFT_CONFIG };
    }
    return {
      startTime: config.value.startTime || DEFAULT_SHIFT_CONFIG.startTime,
      endTime: config.value.endTime || DEFAULT_SHIFT_CONFIG.endTime,
      shiftHours: Number(config.value.shiftHours) || DEFAULT_SHIFT_CONFIG.shiftHours,
      graceMinutes: Number(config.value.graceMinutes ?? DEFAULT_SHIFT_CONFIG.graceMinutes),
      minHoursForFullDay: Number(config.value.minHoursForFullDay) || DEFAULT_SHIFT_CONFIG.minHoursForFullDay,
    };
  } catch (err) {
    console.error("Failed to load attendanceShiftConfig:", err);
    return { ...DEFAULT_SHIFT_CONFIG };
  }
};

/**
 * Calculates whether a check-in is late based on dynamic shift start and grace minutes
 */
export const calculateLateArrival = (checkInDate, shiftConfig) => {
  if (!checkInDate) return { isLate: false, lateMinutes: 0 };

  const m = moment(checkInDate).tz(TZ);
  const cfg = shiftConfig || DEFAULT_SHIFT_CONFIG;

  const parsedStart = moment.tz(`${m.format("YYYY-MM-DD")} ${cfg.startTime}`, "YYYY-MM-DD hh:mm A", TZ);
  const scheduledStart = parsedStart.isValid()
    ? parsedStart
    : moment.tz(`${m.format("YYYY-MM-DD")} ${cfg.startTime}`, "YYYY-MM-DD HH:mm", TZ);

  if (!scheduledStart.isValid()) {
    return { isLate: false, lateMinutes: 0 };
  }

  const graceThreshold = scheduledStart.clone().add(cfg.graceMinutes || 0, "minutes");

  if (m.isAfter(graceThreshold)) {
    const lateMinutes = Math.max(1, m.diff(scheduledStart, "minutes"));
    return { isLate: true, lateMinutes, scheduledStartTime: scheduledStart.format("hh:mm A") };
  }

  return { isLate: false, lateMinutes: 0, scheduledStartTime: scheduledStart.format("hh:mm A") };
};

/**
 * Resolves the shift end moment for a given base date using dynamic shiftConfig.endTime
 */
export const getShiftEndMoment = (baseMoment, shiftConfig) => {
  const m = moment(baseMoment).tz(TZ);
  const cfg = shiftConfig || DEFAULT_SHIFT_CONFIG;

  const parsedEnd = moment.tz(`${m.format("YYYY-MM-DD")} ${cfg.endTime}`, "YYYY-MM-DD hh:mm A", TZ);
  const scheduledEnd = parsedEnd.isValid()
    ? parsedEnd
    : moment.tz(`${m.format("YYYY-MM-DD")} ${cfg.endTime}`, "YYYY-MM-DD HH:mm", TZ);

  if (scheduledEnd.isValid()) {
    return scheduledEnd;
  }

  return m.clone().set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
};

/**
 * Determines DayType and AttendanceStatus based on dynamic minHoursForFullDay
 */
export const determineAttendanceDayType = (workingHours, shiftConfig) => {
  const minFull = Number(shiftConfig?.minHoursForFullDay) || 4;
  const hours = Number(workingHours) || 0;

  if (hours >= minFull) {
    return {
      dayType: DayType.FULL_DAY,
      status: AttendanceStatus.PRESENT,
    };
  }

  return {
    dayType: DayType.HALF_DAY,
    status: AttendanceStatus.HALF_DAY,
  };
};

/**
 * Calculates total working days in a month (excluding week-offs and company holidays) and target shift hours
 */
export const calculateMonthWorkingDaysAndTarget = async (
  baseMoment,
  shiftConfig,
  customDailyHours = null,
) => {
  const m = baseMoment || moment.tz(TZ);
  const startOfMonth = m.clone().startOf("month");
  const endOfMonth = m.clone().endOf("month");
  const daysInMonth = m.daysInMonth();

  const [weekOffConfig, holidays] = await Promise.all([
    Config.findOne({ key: "weekOffDays" }).lean(),
    Holiday.find({
      date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
    }).lean(),
  ]);

  const holidayDateStrings = new Set(
    (holidays || []).map((h) => moment(h.date).tz(TZ).format("YYYY-MM-DD")),
  );

  let workingDaysCount = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayMoment = m.clone().date(d);
    const dateStr = dayMoment.format("YYYY-MM-DD");
    const isHoliday = holidayDateStrings.has(dateStr);
    const isWeekOff = isWeekOffDate(dayMoment.toDate(), weekOffConfig?.value, TZ);

    if (!isHoliday && !isWeekOff) {
      workingDaysCount++;
    }
  }

  const companyDailyHours = Number(shiftConfig?.shiftHours) || 9;
  const dailyHours =
    customDailyHours && customDailyHours > 0 ? customDailyHours : companyDailyHours;
  const targetHours = workingDaysCount * dailyHours;

  return {
    workingDaysCount,
    dailyHours,
    targetHours,
  };
};
