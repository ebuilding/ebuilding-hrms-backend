import moment from "moment-timezone";
import Config from "../models/Config.js";
import Holiday from "../models/Holiday.js";
import { isWeekOffDate } from "./weekOff.js";

const TIMEZONE = "Asia/Kolkata";

export const getWorkingLeaveDays = async ({
  startDate,
  endDate,
  isHalfDay = false,
}) => {
  const start = moment.tz(startDate, "YYYY-MM-DD", TIMEZONE).startOf("day");
  const end = moment.tz(endDate, "YYYY-MM-DD", TIMEZONE).startOf("day");

  if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
    throw new Error("Invalid leave date range");
  }
  if (isHalfDay && !start.isSame(end, "day")) {
    throw new Error("Half-day leave must be for one date");
  }

  const [config, holidays] = await Promise.all([
    Config.findOne({ key: "weekOffDays" }).lean(),
    Holiday.find({
      date: {
        $gte: start.toDate(),
        $lt: end.clone().add(1, "day").toDate(),
      },
    }).lean(),
  ]);
  const holidayDates = new Set(
    holidays.map((holiday) =>
      moment(holiday.date).tz(TIMEZONE).format("YYYY-MM-DD"),
    ),
  );

  const workingDates = [];
  const current = start.clone();
  while (current.isSameOrBefore(end, "day")) {
    const day = current.clone();
    const dateKey = day.format("YYYY-MM-DD");
    const isHoliday = holidayDates.has(dateKey);
    const isWeekOff = isWeekOffDate(day.toDate(), config?.value, TIMEZONE);

    if (!isHoliday && !isWeekOff) workingDates.push(day.toDate());
    current.add(1, "day");
  }

  const chargedDays = isHalfDay
    ? workingDates.length > 0
      ? 0.5
      : 0
    : workingDates.length;

  return { workingDates, chargedDays };
};
