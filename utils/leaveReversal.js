import moment from "moment-timezone";
import LeaveApplication from "../models/LeaveApplication.js";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import { LeaveStatus, LeaveType } from "../constants/enums.js";
import { toDateKey } from "./calendarSchedule.js";

const TIMEZONE = "Asia/Kolkata";

/**
 * Reverts applied or approved leaves when a working day is declared a holiday/off-day.
 * Refunds the deducted leave balance to the employee and cleans up synced Attendance LEAVE records.
 *
 * @param {Date|string} targetDate - The date that was overridden to become an off day
 * @param {string} overrideTitle - Title/name of the override (e.g. "Diwali Holiday")
 * @returns {Promise<Array>} List of affected leave summaries for audit trail
 */
export const revertLeavesForOverrideDate = async (targetDate, overrideTitle = "") => {
  const targetMoment = moment(targetDate).tz(TIMEZONE);
  const targetDateKey = targetMoment.format("YYYY-MM-DD");
  const targetStart = targetMoment.clone().startOf("day").toDate();
  const targetEnd = targetMoment.clone().endOf("day").toDate();

  // Find all leaves overlapping this date that are either APPROVED or PENDING
  const leaves = await LeaveApplication.find({
    status: { $in: [LeaveStatus.APPROVED, LeaveStatus.PENDING] },
    startDate: { $lte: targetEnd },
    endDate: { $gte: targetStart },
  }).populate("employeeId", "firstName lastName email leaveBalance");

  const affectedLeaves = [];

  for (const leave of leaves) {
    if (!leave.employeeId) continue;

    // Check if targetDate was an active working day for this leave
    let wasActiveDay = false;
    if (Array.isArray(leave.workingDates) && leave.workingDates.length > 0) {
      wasActiveDay = leave.workingDates.some(
        (wd) => toDateKey(wd, TIMEZONE) === targetDateKey,
      );
    } else {
      // Fallback for single or range dates
      const s = moment(leave.startDate).tz(TIMEZONE).startOf("day");
      const e = moment(leave.endDate).tz(TIMEZONE).startOf("day");
      wasActiveDay = targetMoment.isSameOrAfter(s, "day") && targetMoment.isSameOrBefore(e, "day");
    }

    if (!wasActiveDay) continue;

    const previousStatus = leave.status;
    const isSingleDay =
      (Array.isArray(leave.workingDates) && leave.workingDates.length <= 1) ||
      moment(leave.startDate).tz(TIMEZONE).isSame(moment(leave.endDate).tz(TIMEZONE), "day");

    const refundDays = leave.isHalfDay ? 0.5 : 1.0;

    if (isSingleDay) {
      // Entire leave is reverted
      leave.status = LeaveStatus.REVERTED;
      leave.revertReason = `Company off declared by Admin: ${overrideTitle || "Calendar Override"}`;
      leave.revertedAt = new Date();
      leave.revertedDates = [targetStart];
      leave.adminUpdatedAt = new Date();
      await leave.save();

      // If it was APPROVED, refund the employee's balance and remove LEAVE attendance
      if (previousStatus === LeaveStatus.APPROVED) {
        const actualRefund = typeof leave.chargedDays === "number" ? leave.chargedDays : refundDays;

        if (leave.type === LeaveType.PAID) {
          await Employee.updateOne(
            { _id: leave.employeeId._id },
            { $inc: { "leaveBalance.paid": actualRefund } },
          );
        } else if (leave.type === LeaveType.COMP_OFF) {
          await Employee.updateOne(
            { _id: leave.employeeId._id },
            { $inc: { "leaveBalance.compOff": actualRefund } },
          );
        }

        // Clean up Attendance records marked as LEAVE for this date
        await Attendance.deleteMany({
          employeeId: leave.employeeId._id,
          date: { $gte: targetStart, $lte: targetEnd },
          status: "LEAVE",
        });
      }

      affectedLeaves.push({
        leaveId: leave._id,
        employeeId: leave.employeeId._id,
        employeeName: `${leave.employeeId.firstName || ""} ${leave.employeeId.lastName || ""}`.trim(),
        employeeEmail: leave.employeeId.email,
        leaveType: leave.type,
        refundedDays: previousStatus === LeaveStatus.APPROVED ? (leave.chargedDays || refundDays) : 0,
        previousStatus,
      });
    } else {
      // Multi-day leave: remove targetDate from workingDates, add to revertedDates
      if (Array.isArray(leave.workingDates)) {
        leave.workingDates = leave.workingDates.filter(
          (wd) => toDateKey(wd, TIMEZONE) !== targetDateKey,
        );
      }

      if (!Array.isArray(leave.revertedDates)) {
        leave.revertedDates = [];
      }
      leave.revertedDates.push(targetStart);

      const prevCharged = leave.chargedDays || 1;
      const newCharged = Math.max(0, prevCharged - refundDays);
      leave.chargedDays = newCharged;

      // If working dates remain, adjust startDate & endDate to actual remaining active dates
      if (Array.isArray(leave.workingDates) && leave.workingDates.length > 0) {
        const sorted = [...leave.workingDates].sort(
          (a, b) => new Date(a).getTime() - new Date(b).getTime(),
        );
        leave.startDate = sorted[0];
        leave.endDate = sorted[sorted.length - 1];
        leave.revertReason = `Date ${targetMoment.format("MMM D")} reverted & refunded due to: ${overrideTitle || "Calendar Override"}`;
      } else {
        // If no working dates remain, mark as REVERTED
        leave.status = LeaveStatus.REVERTED;
        leave.revertReason = `All dates covered by company off: ${overrideTitle || "Calendar Override"}`;
        leave.revertedAt = new Date();
      }

      leave.adminUpdatedAt = new Date();
      await leave.save();

      // If approved, refund the 1 day deducted for this date
      if (previousStatus === LeaveStatus.APPROVED) {
        if (leave.type === LeaveType.PAID) {
          await Employee.updateOne(
            { _id: leave.employeeId._id },
            { $inc: { "leaveBalance.paid": refundDays } },
          );
        } else if (leave.type === LeaveType.COMP_OFF) {
          await Employee.updateOne(
            { _id: leave.employeeId._id },
            { $inc: { "leaveBalance.compOff": refundDays } },
          );
        }

        // Clean up Attendance LEAVE on targetDate
        await Attendance.deleteMany({
          employeeId: leave.employeeId._id,
          date: { $gte: targetStart, $lte: targetEnd },
          status: "LEAVE",
        });
      }

      affectedLeaves.push({
        leaveId: leave._id,
        employeeId: leave.employeeId._id,
        employeeName: `${leave.employeeId.firstName || ""} ${leave.employeeId.lastName || ""}`.trim(),
        employeeEmail: leave.employeeId.email,
        leaveType: leave.type,
        refundedDays: previousStatus === LeaveStatus.APPROVED ? refundDays : 0,
        previousStatus,
      });
    }
  }

  return affectedLeaves;
};
