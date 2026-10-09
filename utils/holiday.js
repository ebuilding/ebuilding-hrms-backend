import moment from "moment-timezone";
import Holiday from "../models/Holiday.js";

export const findHolidayForDate = (date, timezone = "Asia/Kolkata") => {
  const dayStart = moment(date).tz(timezone).startOf("day");
  const nextDayStart = dayStart.clone().add(1, "day");

  return Holiday.findOne({
    date: {
      $gte: dayStart.toDate(),
      $lt: nextDayStart.toDate(),
    },
  }).lean();
};
