import moment from "moment-timezone";

export const isWeekOffDate = (date, schedule, timezone = "Asia/Kolkata") => {
  const localDate = moment(date).tz(timezone);
  const dayName = localDate.format("dddd");

  if (Array.isArray(schedule)) {
    return schedule.includes(dayName);
  }

  if (!schedule || typeof schedule !== "object") return false;
  if (schedule.weeklyDays?.includes(dayName)) return true;

  const occurrence = Math.ceil(localDate.date() / 7);
  return schedule.monthlyDays?.[dayName]?.includes(occurrence) ?? false;
};
