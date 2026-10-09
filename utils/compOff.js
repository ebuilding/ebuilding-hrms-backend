import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import Config from "../models/Config.js";
import LeaveApplication from "../models/LeaveApplication.js";
import { isWeekOffDate } from "./weekOff.js";
import { findHolidayForDate } from "./holiday.js";

const TZ = "Asia/Kolkata";

const DEFAULT_LEAVE_BALANCE = {
  paid: 12,
  compOff: 0,
  lastYearRemaining: 0,
};

/** Comp-off days earned for a completed week-off / holiday shift. */
export const getCompOffCreditDays = (attendance) => {
  const label = attendance?.compoffFor;
  if (!label || (typeof label === "string" && !label.trim())) return 0;
  if (!attendance.checkIn || !attendance.checkOut) return 0;

  if (attendance.dayType === "Half Day") return 0.5;
  if (attendance.dayType === "Full Day") return 1;

  const hours = attendance.workingHours ?? 0;
  if (hours >= 8) return 1;
  if (hours >= 4) return 0.5;
  return 0;
};

export const getCompOffLabelForDate = async (date) => {
  const dayStart = moment(date).tz(TZ).startOf("day").toDate();
  const holiday = await findHolidayForDate(dayStart, TZ);
  if (holiday) return "Holiday";

  const config = await Config.findOne({ key: "weekOffDays" }).lean();
  if (isWeekOffDate(dayStart, config?.value, TZ)) return "Week Off";

  return null;
};

export const ensureLeaveBalance = async (employeeId) => {
  await Employee.updateOne(
    {
      _id: employeeId,
      $or: [{ leaveBalance: { $exists: false } }, { leaveBalance: null }],
    },
    { $set: { leaveBalance: { ...DEFAULT_LEAVE_BALANCE } } },
    { runValidators: false },
  );
};

const compOffLeaveDaysUsed = (leave) => {
  if (leave.isHalfDay) return 0.5;
  const start = moment(leave.startDate).tz(TZ).startOf("day");
  const end = moment(leave.endDate).tz(TZ).startOf("day");
  return end.diff(start, "days") + 1;
};

/**
 * Recompute leaveBalance.compOff from credited attendance minus approved comp-off leaves.
 */
export const syncCompOffBalanceForEmployee = async (employeeId) => {
  await ensureLeaveBalance(employeeId);

  const [creditedAttendance, approvedCompOffLeaves] = await Promise.all([
    Attendance.find({
      employeeId,
      compOffCredited: true,
      compoffFor: { $nin: [null, ""] },
      checkIn: { $ne: null },
      checkOut: { $ne: null },
    }).lean(),
    LeaveApplication.find({
      employeeId,
      type: "COMP_OFF",
      status: "APPROVED",
    }).lean(),
  ]);

  const earned = creditedAttendance.reduce(
    (sum, row) => sum + getCompOffCreditDays(row),
    0,
  );
  const used = approvedCompOffLeaves.reduce(
    (sum, leave) => sum + compOffLeaveDaysUsed(leave),
    0,
  );
  const balance = Math.max(0, parseFloat((earned - used).toFixed(2)));

  await Employee.updateOne(
    { _id: employeeId },
    { $set: { "leaveBalance.compOff": balance } },
    { runValidators: false },
  );

  return { earned, used, balance };
};

/**
 * Credits employee comp-off balance for a completed attendance record.
 * Idempotent via attendance.compOffCredited.
 */
export const creditCompOffForAttendance = async (attendance) => {
  const id = attendance?._id ?? attendance;
  if (!id) {
    return { credited: 0, skipped: true, reason: "no_id" };
  }

  const record = await Attendance.findById(id).lean();
  if (!record) {
    return { credited: 0, skipped: true, reason: "not_found" };
  }
  if (record.compOffCredited) {
    return { credited: 0, skipped: true, reason: "already_credited" };
  }

  const days = getCompOffCreditDays(record);
  if (days <= 0) {
    return { credited: 0, skipped: true, reason: "not_eligible" };
  }

  const employeeExists = await Employee.exists({ _id: record.employeeId });
  if (!employeeExists) {
    return { credited: 0, skipped: true, reason: "employee_not_found" };
  }

  const marked = await Attendance.updateOne(
    { _id: id, compOffCredited: { $ne: true } },
    { $set: { compOffCredited: true } },
    { runValidators: false },
  );

  if (marked.modifiedCount === 0) {
    return { credited: 0, skipped: true, reason: "already_credited" };
  }

  const sync = await syncCompOffBalanceForEmployee(record.employeeId);

  return {
    credited: days,
    skipped: false,
    balanceAfter: sync.balance,
    earned: sync.earned,
    used: sync.used,
  };
};
