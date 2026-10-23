import moment from "moment-timezone";
import { CalendarOverrideType } from "../constants/enums.js";
import { isWeekOffDate } from "./weekOff.js";

const TIMEZONE = "Asia/Kolkata";

/**
 * Normalizes any date or date string to YYYY-MM-DD in the given timezone
 */
export const toDateKey = (date, tz = TIMEZONE) => {
  if (!date) return "";
  return moment(date).tz(tz).format("YYYY-MM-DD");
};

/**
 * Centralized schedule resolution for a specific date
 *
 * Precedence Hierarchy:
 * 1. CalendarOverride (Direct admin directive: overrides holidays and weekends)
 *    - HOLIDAY: Day is off / company holiday
 *    - WORKING_DAY: Day is mandatory working day (even if weekend/holiday)
 *    - SWAP (date): Original date is off / rest day
 *    - SWAP (swapDate): Compensatory date is working day
 * 2. Official Holiday collection
 * 3. WeekOff configuration (Sundays, alternate Saturdays)
 * 4. Default: Scheduled working day
 */
export const getCalendarDaySchedule = (
  dateInput,
  { overrides = [], holidays = [], weekOffConfig = null, timezone = TIMEZONE } = {},
) => {
  const dayMoment = moment(dateInput).tz(timezone);
  const dateKey = dayMoment.format("YYYY-MM-DD");
  const dayName = dayMoment.format("dddd");

  // 1. Check Calendar Overrides
  for (const override of overrides) {
    const overrideDateKey = toDateKey(override.date, timezone);
    const swapDateKey = override.swapDate ? toDateKey(override.swapDate, timezone) : null;

    if (overrideDateKey === dateKey) {
      if (override.type === CalendarOverrideType.HOLIDAY) {
        return {
          dateKey,
          dayMoment,
          dayName,
          isWorkingDay: false,
          isHoliday: true,
          isWeekOff: false,
          isOverride: true,
          overrideType: CalendarOverrideType.HOLIDAY,
          label: override.title || "Holiday",
          reason: override.reason || "",
          overrideRecord: override,
        };
      }

      if (override.type === CalendarOverrideType.WORKING_DAY) {
        return {
          dateKey,
          dayMoment,
          dayName,
          isWorkingDay: true,
          isHoliday: false,
          isWeekOff: false,
          isOverride: true,
          overrideType: CalendarOverrideType.WORKING_DAY,
          label: override.title || "Working Day",
          reason: override.reason || "",
          overrideRecord: override,
        };
      }

      if (override.type === CalendarOverrideType.SWAP) {
        return {
          dateKey,
          dayMoment,
          dayName,
          isWorkingDay: false,
          isHoliday: true,
          isWeekOff: false,
          isOverride: true,
          overrideType: CalendarOverrideType.SWAP,
          isSwapOff: true,
          label: `${override.title} (Off Day)`,
          reason: override.reason || "",
          overrideRecord: override,
        };
      }
    }

    if (override.type === CalendarOverrideType.SWAP && swapDateKey === dateKey) {
      return {
        dateKey,
        dayMoment,
        dayName,
        isWorkingDay: true,
        isHoliday: false,
        isWeekOff: false,
        isOverride: true,
        overrideType: CalendarOverrideType.SWAP,
        isSwapWork: true,
        label: `${override.title} (Compensatory Work)`,
        reason: override.reason || "",
        overrideRecord: override,
      };
    }
  }

  // 2. Check Official Company Holidays
  for (const h of holidays) {
    const holidayDateKey = toDateKey(h.date, timezone);
    if (holidayDateKey === dateKey) {
      return {
        dateKey,
        dayMoment,
        dayName,
        isWorkingDay: false,
        isHoliday: true,
        isWeekOff: false,
        isOverride: false,
        overrideType: null,
        label: h.name || "Holiday",
        reason: "",
        holidayRecord: h,
      };
    }
  }

  // 3. Check Week Off Configuration
  const effectiveWeekOff = weekOffConfig || { weeklyDays: ["Sunday"], monthlyDays: {} };
  const isWeekOff = isWeekOffDate(dayMoment.toDate(), effectiveWeekOff, timezone);
  if (isWeekOff) {
    return {
      dateKey,
      dayMoment,
      dayName,
      isWorkingDay: false,
      isHoliday: false,
      isWeekOff: true,
      isOverride: false,
      overrideType: null,
      label: `Week Off (${dayName})`,
      reason: "",
    };
  }

  // 4. Default Working Day
  return {
    dateKey,
    dayMoment,
    dayName,
    isWorkingDay: true,
    isHoliday: false,
    isWeekOff: false,
    isOverride: false,
    overrideType: null,
    label: "Working Day",
    reason: "",
  };
};

/**
 * Resolves entire month schedule metadata and counts total company working days
 */
export const resolveMonthSchedule = (
  baseMoment,
  { overrides = [], holidays = [], weekOffConfig = null, timezone = TIMEZONE } = {},
) => {
  const m = moment(baseMoment).tz(timezone);
  const startOfMonth = m.clone().startOf("month");
  const daysInMonth = m.daysInMonth();

  let companyWorkingDays = 0;
  const monthDaysMeta = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dayMoment = startOfMonth.clone().date(d);
    const daySchedule = getCalendarDaySchedule(dayMoment, {
      overrides,
      holidays,
      weekOffConfig,
      timezone,
    });

    if (daySchedule.isWorkingDay) {
      companyWorkingDays++;
    }

    monthDaysMeta.push(daySchedule);
  }

  return {
    monthDaysMeta,
    companyWorkingDays,
    daysInMonth,
  };
};
