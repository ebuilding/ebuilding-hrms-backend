import moment from "moment-timezone";
import CalendarOverride from "../models/CalendarOverride.js";
import Holiday from "../models/Holiday.js";
import Config from "../models/Config.js";
import { CalendarOverrideType } from "../constants/enums.js";
import { getCalendarDaySchedule } from "../utils/calendarSchedule.js";
import { revertLeavesForOverrideDate } from "../utils/leaveReversal.js";
import { sendCalendarOverrideNotifications } from "../utils/calendarOverrideEmail.js";

const TIMEZONE = "Asia/Kolkata";

/**
 * GET /api/calendar-overrides?year=YYYY
 * Fetches all calendar overrides for a given year (defaults to current year)
 */
export const getCalendarOverrides = async (req, res) => {
  try {
    const year = req.query.year
      ? parseInt(req.query.year, 10)
      : moment.tz(TIMEZONE).year();

    const overrides = await CalendarOverride.find({ year })
      .sort({ date: 1 })
      .lean();

    return res.json({ success: true, data: overrides });
  } catch (error) {
    console.error("getCalendarOverrides Error:", error);
    return res.status(500).json({ error: "Failed to fetch calendar overrides" });
  }
};

/**
 * POST /api/calendar-overrides
 * Creates a calendar override, reverts overlapping leaves, and dispatches employee notifications
 */
export const createCalendarOverride = async (req, res) => {
  try {
    const { type, date, title, reason, swapDate } = req.body;

    if (!type || !Object.values(CalendarOverrideType).includes(type)) {
      return res.status(400).json({
        error: `Invalid override type. Must be one of: ${Object.values(CalendarOverrideType).join(", ")}`,
      });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required for the override" });
    }

    if (!date) {
      return res.status(400).json({ error: "Date is required" });
    }

    const todayStart = moment.tz(TIMEZONE).startOf("day");
    const targetMoment = moment.tz(date, "YYYY-MM-DD", TIMEZONE).startOf("day");

    if (!targetMoment.isValid()) {
      return res.status(400).json({ error: "Invalid date format. Expected YYYY-MM-DD" });
    }

    // Constraint: Only today and future dates can be overridden
    if (targetMoment.isBefore(todayStart, "day")) {
      return res.status(400).json({
        error: "Cannot create schedule overrides for past dates. Only today or future dates are allowed.",
      });
    }

    let normalizedSwapDate = null;
    let swapMoment = null;

    if (type === CalendarOverrideType.SWAP) {
      if (!swapDate) {
        return res.status(400).json({
          error: "Compensatory working date (swapDate) is required for schedule swaps",
        });
      }

      swapMoment = moment.tz(swapDate, "YYYY-MM-DD", TIMEZONE).startOf("day");

      if (!swapMoment.isValid()) {
        return res.status(400).json({ error: "Invalid swapDate format. Expected YYYY-MM-DD" });
      }

      if (swapMoment.isBefore(todayStart, "day")) {
        return res.status(400).json({
          error: "Compensatory working date cannot be in the past.",
        });
      }

      if (swapMoment.isSame(targetMoment, "day")) {
        return res.status(400).json({
          error: "The original off day and the compensatory working day cannot be the same date.",
        });
      }

      normalizedSwapDate = swapMoment.toDate();
    }

    const normalizedDate = targetMoment.toDate();
    const year = targetMoment.year();

    // Conflict check: Ensure no active override already occupies these dates
    const conflictQuery = [
      { date: normalizedDate },
      { swapDate: normalizedDate },
    ];

    if (normalizedSwapDate) {
      conflictQuery.push({ date: normalizedSwapDate });
      conflictQuery.push({ swapDate: normalizedSwapDate });
    }

    const existingConflict = await CalendarOverride.findOne({
      year,
      $or: conflictQuery,
    });

    if (existingConflict) {
      return res.status(400).json({
        error: `A schedule override already exists on or overlaps with the selected date (${moment(existingConflict.date).tz(TIMEZONE).format("YYYY-MM-DD")}).`,
      });
    }

    // Pre-condition schedule validation: Ensure the date nature matches the override type
    const queryRangeStart = targetMoment.clone().subtract(7, "days").toDate();
    const queryRangeEnd = (swapMoment || targetMoment).clone().add(7, "days").toDate();

    const [holidays, weekOffConfigDoc] = await Promise.all([
      Holiday.find({
        date: { $gte: queryRangeStart, $lte: queryRangeEnd },
      }).lean(),
      Config.findOne({ key: "weekOffDays" }).lean(),
    ]);

    const weekOffConfig = weekOffConfigDoc?.value || { weeklyDays: ["Sunday"], monthlyDays: {} };

    const targetSchedule = getCalendarDaySchedule(targetMoment, {
      holidays,
      weekOffConfig,
      timezone: TIMEZONE,
    });

    if (type === CalendarOverrideType.HOLIDAY) {
      if (!targetSchedule.isWorkingDay) {
        return res.status(400).json({
          error: `Cannot declare ${targetMoment.format("YYYY-MM-DD")} as a holiday because it is already an off day (${targetSchedule.label}).`,
        });
      }
    } else if (type === CalendarOverrideType.WORKING_DAY) {
      if (targetSchedule.isWorkingDay) {
        return res.status(400).json({
          error: `Cannot mark ${targetMoment.format("YYYY-MM-DD")} as a mandatory working day because it is already a regular scheduled working day.`,
        });
      }
    } else if (type === CalendarOverrideType.SWAP) {
      if (!targetSchedule.isWorkingDay) {
        return res.status(400).json({
          error: `The day to give off (${targetMoment.format("YYYY-MM-DD")}) is already an off day (${targetSchedule.label}). Only scheduled working days can be swapped for rest.`,
        });
      }

      const swapSchedule = getCalendarDaySchedule(swapMoment, {
        holidays,
        weekOffConfig,
        timezone: TIMEZONE,
      });

      if (swapSchedule.isWorkingDay) {
        return res.status(400).json({
          error: `The compensatory date (${swapMoment.format("YYYY-MM-DD")}) is already a regular working day. Only weekends or holidays can be designated as compensatory working shifts.`,
        });
      }
    }

    // If type is HOLIDAY or SWAP, the primary date is an off-day -> Revert leaves and refund balances
    let affectedLeaves = [];
    if (type === CalendarOverrideType.HOLIDAY || type === CalendarOverrideType.SWAP) {
      affectedLeaves = await revertLeavesForOverrideDate(normalizedDate, title);
    }

    // Create the override document
    const override = await CalendarOverride.create({
      type,
      date: normalizedDate,
      title: title.trim(),
      reason: (reason || "").trim(),
      swapDate: normalizedSwapDate,
      affectedLeaves,
      year,
      createdBy: req.session?.email || "Admin",
    });

    // Notify employees via email asynchronously
    sendCalendarOverrideNotifications(override, affectedLeaves).catch((err) => {
      console.error("sendCalendarOverrideNotifications async error:", err);
    });

    return res.status(201).json({
      success: true,
      data: override,
      affectedLeavesCount: affectedLeaves.length,
      message: `Schedule override created successfully.${
        affectedLeaves.length > 0
          ? ` ${affectedLeaves.length} applied/approved leave(s) were automatically reverted and refunded.`
          : ""
      }`,
    });
  } catch (error) {
    console.error("createCalendarOverride Error:", error);
    return res.status(500).json({ error: error.message || "Failed to create schedule override" });
  }
};

/**
 * DELETE /api/calendar-overrides/:id
 * Removes a calendar override.
 * Rule: Past overrides cannot be deleted.
 * If deleting a WORKING_DAY or SWAP work date, any leaves booked on that day are refunded.
 */
export const deleteCalendarOverride = async (req, res) => {
  try {
    const { id } = req.params;

    const override = await CalendarOverride.findById(id);
    if (!override) {
      return res.status(404).json({ error: "Schedule override not found" });
    }

    const todayStart = moment.tz(TIMEZONE).startOf("day");
    const targetMoment = moment(override.date).tz(TIMEZONE).startOf("day");

    if (targetMoment.isBefore(todayStart, "day")) {
      return res.status(400).json({
        error: "Historical schedule overrides in the past cannot be deleted.",
      });
    }

    // If deleting a WORKING_DAY override or SWAP compensatory work date:
    // Any leave taken for that compensatory day should now be refunded & reverted.
    let compensatoryWorkDate = null;
    if (override.type === CalendarOverrideType.WORKING_DAY) {
      compensatoryWorkDate = override.date;
    } else if (override.type === CalendarOverrideType.SWAP && override.swapDate) {
      compensatoryWorkDate = override.swapDate;
    }

    let revertedWorkLeaves = [];
    if (compensatoryWorkDate) {
      revertedWorkLeaves = await revertLeavesForOverrideDate(
        compensatoryWorkDate,
        `Compensatory work schedule cancelled: ${override.title}`
      );
    }

    await CalendarOverride.findByIdAndDelete(id);

    return res.json({
      success: true,
      revertedWorkLeavesCount: revertedWorkLeaves.length,
      message: `Schedule override deleted successfully.${
        revertedWorkLeaves.length > 0
          ? ` ${revertedWorkLeaves.length} leave(s) on the cancelled compensatory working day were automatically refunded.`
          : " Any leaves previously reverted for off-days remain reverted as per company policy."
      }`,
    });
  } catch (error) {
    console.error("deleteCalendarOverride Error:", error);
    return res.status(500).json({ error: "Failed to delete schedule override" });
  }
};
