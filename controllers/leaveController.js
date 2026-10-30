import moment from "moment-timezone";
import { inngest } from "../inngest/index.js";
import sendEmail from "../config/nodemailer.js";
import { getEmailTemplate } from "../utils/emailTemplates.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import LeavePolicy from "../models/LeavePolicy.js";
import Attendance from "../models/Attendance.js";
import Holiday from "../models/Holiday.js";
import CalendarOverride from "../models/CalendarOverride.js";
import { getWorkingLeaveDays } from "../utils/leaveDays.js";
import {
  processPaidLeaveGrants,
  releasePaidLeaveReservation,
  reservePaidLeave,
  settlePaidLeaveApproval,
} from "../utils/paidLeave.js";
import { LeaveType, LeaveStatus, DayType, AttendanceStatus } from "../constants/enums.js";

const TZ = "Asia/Kolkata";

const getLeaveWorkData = async (leave) => {
  if (Array.isArray(leave.workingDates)) {
    return {
      workingDates: leave.workingDates,
      chargedDays: leave.chargedDays ?? leave.workingDates.length,
    };
  }

  const dates = await getWorkingLeaveDays({
    startDate: moment(leave.startDate).tz(TZ).format("YYYY-MM-DD"),
    endDate: moment(leave.endDate).tz(TZ).format("YYYY-MM-DD"),
    isHalfDay: leave.isHalfDay,
  });
  leave.workingDates = dates.workingDates;
  leave.chargedDays = dates.chargedDays;
  await leave.save();
  return dates;
};

const syncLeaveWithAttendance = async (leave, adminEmail) => {
  const { workingDates, chargedDays } = await getLeaveWorkData(leave);
  if (chargedDays <= 0) return;

  const isDirectAdminLeave = Boolean(leave.addedBy);

  for (const workingDate of workingDates) {
    const dateStart = moment(workingDate).tz(TZ).startOf("day").toDate();
    const dateEnd = moment(workingDate).tz(TZ).endOf("day").toDate();

    let attendanceRecord = await Attendance.findOne({
      employeeId: leave.employeeId,
      date: { $gte: dateStart, $lte: dateEnd },
    });

    if (attendanceRecord) {
      attendanceRecord.status = AttendanceStatus.LEAVE;
      attendanceRecord.dayType = leave.isHalfDay ? DayType.HALF_DAY : DayType.FULL_DAY;
      attendanceRecord.checkIn = null;
      attendanceRecord.checkOut = null;
      attendanceRecord.workingHours = null;
      attendanceRecord.isDirectAdminLeave = isDirectAdminLeave;
      if (isDirectAdminLeave) {
        attendanceRecord.updatedBy = leave.addedBy || adminEmail || "System";
        attendanceRecord.adminUpdatedAt = leave.adminUpdatedAt || new Date();
      } else {
        attendanceRecord.updatedBy = null;
        attendanceRecord.adminUpdatedAt = null;
      }
      await attendanceRecord.save();
    } else {
      await Attendance.create({
        employeeId: leave.employeeId,
        date: dateStart,
        status: AttendanceStatus.LEAVE,
        dayType: leave.isHalfDay ? DayType.HALF_DAY : DayType.FULL_DAY,
        checkIn: null,
        checkOut: null,
        workingHours: null,
        isDirectAdminLeave,
        updatedBy: isDirectAdminLeave ? (leave.addedBy || adminEmail || "System") : null,
        adminUpdatedAt: isDirectAdminLeave ? (leave.adminUpdatedAt || new Date()) : null,
      });
    }
  }
};

const revertLeaveAttendance = async (leave) => {
  const { workingDates } = await getLeaveWorkData(leave);
  for (const workingDate of workingDates) {
    const dateStart = moment(workingDate).tz(TZ).startOf("day").toDate();
    const dateEnd = moment(workingDate).tz(TZ).endOf("day").toDate();

    await Attendance.deleteMany({
      employeeId: leave.employeeId,
      date: { $gte: dateStart, $lte: dateEnd },
      status: "LEAVE",
    });
  }
};

// Create leave
// POST /api/leaves
export const createLeave = async (req, res) => {
  try {
    const session = req.session;
    const employee = await Employee.findOne({ userId: session.userId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (employee.isDeleted) {
      return res.status(403).json({
        error: "Your account is deactivated. You cannot apply for leave.",
      });
    }

    const { type, startDate, endDate, reason, isHalfDay, halfDayType } =
      req.body;

    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const today = moment.tz(TZ).startOf("day");
    const start = moment.tz(startDate, "YYYY-MM-DD", TZ).startOf("day");
    const end = moment.tz(endDate, "YYYY-MM-DD", TZ).startOf("day");

    if (start.isBefore(today) || end.isBefore(today)) {
      return res
        .status(400)
        .json({ error: "Leave dates cannot be in the past" });
    }

    if (end.isBefore(start)) {
      return res
        .status(400)
        .json({ error: "End date cannot be before start date" });
    }

    if (![LeaveType.PAID, LeaveType.UNPAID, LeaveType.COMP_OFF].includes(type)) {
      return res.status(400).json({ error: "Invalid leave type" });
    }

    const { workingDates, chargedDays } = await getWorkingLeaveDays({
      startDate,
      endDate,
      isHalfDay: Boolean(isHalfDay),
    });
    if (chargedDays <= 0) {
      return res
        .status(400)
        .json({ error: "Selected dates contain no working days" });
    }

    if (type === LeaveType.COMP_OFF) {
      if ((employee.leaveBalance?.compOff || 0) < chargedDays) {
        return res.status(400).json({ error: "Insufficient comp-off balance" });
      }
    }

    const leave = await LeaveApplication.create({
      employeeId: employee._id,
      type,
      isHalfDay: !!isHalfDay,
      halfDayType: isHalfDay ? halfDayType : null,
      startDate: start.toDate(),
      endDate: end.toDate(),
      workingDates,
      chargedDays,
      reason,
      status: LeaveStatus.PENDING,
    });

    if (type === LeaveType.PAID) {
      try {
        await reservePaidLeave(leave, employee, workingDates);
      } catch (error) {
        await LeaveApplication.deleteOne({ _id: leave._id });
        return res.status(400).json({ error: error.message });
      }
    }

    try {
      await inngest.send({
        name: "leave/pending",
        data: { leaveApplicationId: leave._id },
      });
    } catch (error) {
      console.error("Failed to enqueue leave reminder:", error);
    }

    return res.json({ success: true, data: leave });
  } catch (error) {
    console.error("Create Leave Error:", error);
    return res.status(500).json({ error: "Failed" });
  }
};

// Get leaves
// GET /api/leaves
export const getLeaves = async (req, res) => {
  try {
    const session = req.session;
    const isAdmin = session.role === "ADMIN";
    const policy = await LeavePolicy.findOne({ scope: "COMPANY" }).lean();
    const hasPaidPolicy = Boolean(policy);

    if (isAdmin) {
      const status = req.query.status;
      const where = status ? { status } : {};
      const leaves = await LeaveApplication.find(where)
        .select("type status startDate endDate reason isHalfDay halfDayType chargedDays createdAt updatedAt employeeId addedBy adminUpdatedAt workingDates revertedDates revertReason revertedAt revokeReason revokeRequestedAt revokeRequestedBy")
        .populate({
          path: "employeeId",
          select: "firstName lastName department profile_img position",
          populate: { path: "department", select: "name" },
        })
        .sort({ createdAt: -1 })
        .lean();
      const data = leaves.map((l) => {
        return {
          ...l,
          id: l._id.toString(),
          employee: l.employeeId,
          employeeId: l.employeeId?._id?.toString(),
        };
      });
      return res.json({ data, hasPaidPolicy });
    } else {
      let employee = await Employee.findOne({
        userId: session.userId,
      }).lean();
      if (!employee) return res.status(404).json({ error: "Not found" });

      // Process any pending grants dynamically before sending to UI
      await processPaidLeaveGrants(employee._id);
      // Re-fetch the employee with updated balances, projecting only needed fields
      employee = await Employee.findOne({ userId: session.userId })
        .select("firstName lastName leaveBalance isDeleted")
        .lean();

      const leaves = await LeaveApplication.find({
        employeeId: employee._id,
      })
        .select("type status startDate endDate reason isHalfDay halfDayType chargedDays createdAt updatedAt addedBy adminUpdatedAt workingDates revertedDates revertReason revertedAt revokeReason revokeRequestedAt revokeRequestedBy")
        .sort({ createdAt: -1 })
        .lean();
      return res.json({
        data: leaves,
        employee: { ...employee, id: employee._id.toString() },
        hasPaidPolicy,
      });
    }
  } catch (error) {
    return res.status(500).json({ error: "Failed" });
  }
};

// Update leave status (Admin Approve / Reject / Pending)
// PATCH /api/leaves/:id
export const updateLeaveStatus = async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const leave = await LeaveApplication.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: "Leave not found" });

    const employee = await Employee.findById(leave.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    // If status is changing to APPROVED, deduct balance
    if (status === "APPROVED" && leave.status !== "APPROVED") {
      if (leave.type === "PAID") {
        await settlePaidLeaveApproval(leave, req.session.email);
      } else if (leave.type === "COMP_OFF") {
        if (employee.leaveBalance.compOff < leave.chargedDays) {
          return res
            .status(400)
            .json({ error: "Insufficient comp-off balance" });
        }
        employee.leaveBalance.compOff -= leave.chargedDays;
        await employee.save();
      }
      
      // Sync with Attendance model since it is approved
      await syncLeaveWithAttendance(leave, req.session.email);
    }

    if (status === "REJECTED" && leave.status !== "REJECTED") {
      if (leave.type === "PAID") {
        await releasePaidLeaveReservation(leave, req.session.email);
      }
      if (rejectionReason) {
        leave.rejectionReason = rejectionReason.trim();
        leave.revertReason = rejectionReason.trim();
      }
    }

    // Revert synced Attendance records if leave status changes from APPROVED to something else
    if (leave.status === "APPROVED" && status !== "APPROVED") {
      await revertLeaveAttendance(leave);
    }

    const previousStatus = leave.status;
    leave.status = status;
    await leave.save();

    // Send email notification to employee
    try {
      if (employee.email && previousStatus !== status) {
        const startStr = moment(leave.startDate).tz(TZ).format("MMM DD, YYYY");
        const endStr = moment(leave.endDate).tz(TZ).format("MMM DD, YYYY");

        if (status === "APPROVED") {
          await sendEmail({
            to: employee.email,
            subject: `Leave Application Approved ✅`,
            body: getEmailTemplate(
              `
<h2 style="margin:0 0 16px; font-size:22px; color:#111827; font-weight:700;">
  Leave Approved! 🎉
</h2>
<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.7;">
  Hi ${employee.firstName}, your <strong>${leave.type}</strong> leave application from <strong>${startStr} to ${endStr}</strong> has been approved.
</p>
<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:14px; padding:18px; margin:20px 0; color:#166534; font-size:14px;">
  <strong>Deducted Days:</strong> ${leave.chargedDays} day(s)
</div>
              `,
              "Leave Application Approved"
            ),
          });
        } else if (status === "REJECTED") {
          await sendEmail({
            to: employee.email,
            subject: `Leave Application Update`,
            body: getEmailTemplate(
              `
<h2 style="margin:0 0 16px; font-size:22px; color:#111827; font-weight:700;">
  Leave Application Rejected
</h2>
<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.7;">
  Hi ${employee.firstName}, your leave application for <strong>${startStr} to ${endStr}</strong> has been rejected by the administrator.
</p>
${leave.rejectionReason ? `
<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:12px; padding:14px 18px; margin:16px 0; color:#991b1b; font-size:14px; line-height:1.6;">
  <strong>Reason for Rejection:</strong> ${leave.rejectionReason}
</div>` : ""}
              `,
              "Leave Application Rejected"
            ),
          });
        }
      }
    } catch (mailErr) {
      console.error("Failed to email employee about status change:", mailErr);
    }

    return res.json({ success: true, data: leave });
  } catch (error) {
    return res.status(500).json({ error: "Failed" });
  }
};

// Edit pending leave application
// PUT /api/leave/:id
export const editPendingLeave = async (req, res) => {
  try {
    const session = req.session;
    const leaveId = req.params.id;
    const leave = await LeaveApplication.findById(leaveId);
    if (!leave) return res.status(404).json({ error: "Leave application not found" });

    // Only pending leaves can be edited
    if (leave.status !== LeaveStatus.PENDING) {
      return res.status(400).json({ error: "Only pending leave applications can be edited" });
    }

    const isAdmin = session.role === "ADMIN";
    const employee = await Employee.findById(leave.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    if (!isAdmin && employee.userId?.toString() !== session.userId) {
      return res.status(403).json({ error: "Unauthorized to edit this leave application" });
    }

    if (employee.isDeleted) {
      return res.status(403).json({ error: "Deactivated employee accounts cannot edit leaves" });
    }

    const { type, startDate, endDate, reason, isHalfDay, halfDayType } = req.body;
    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (![LeaveType.PAID, LeaveType.UNPAID, LeaveType.COMP_OFF].includes(type)) {
      return res.status(400).json({ error: "Invalid leave type" });
    }

    const today = moment.tz(TZ).startOf("day");
    const start = moment.tz(startDate, "YYYY-MM-DD", TZ).startOf("day");
    const end = moment.tz(endDate, "YYYY-MM-DD", TZ).startOf("day");

    if (end.isBefore(start)) {
      return res.status(400).json({ error: "End date cannot be before start date" });
    }

    if (!isAdmin && start.isBefore(today)) {
      return res.status(400).json({ error: "Leave dates cannot be in the past" });
    }

    const { workingDates, chargedDays } = await getWorkingLeaveDays({
      startDate,
      endDate,
      isHalfDay: Boolean(isHalfDay),
    });

    if (chargedDays <= 0) {
      return res.status(400).json({ error: "Selected dates contain no working days" });
    }

    // If previously PAID with active reservation, release it first
    if (leave.type === LeaveType.PAID && leave.paidReservationActive) {
      await releasePaidLeaveReservation(leave, session.email);
    }

    if (type === LeaveType.PAID) {
      const policy = await LeavePolicy.findOne({ scope: "COMPANY" }).lean();
      if (!policy) {
        return res.status(400).json({ error: "Paid leave policy is not configured" });
      }
      leave.type = type;
      leave.startDate = start.toDate();
      leave.endDate = end.toDate();
      leave.reason = reason;
      leave.isHalfDay = Boolean(isHalfDay);
      leave.halfDayType = isHalfDay ? halfDayType : null;
      leave.workingDates = workingDates;
      leave.chargedDays = chargedDays;
      await reservePaidLeave(leave, employee, workingDates);
    } else if (type === LeaveType.COMP_OFF) {
      if (employee.leaveBalance.compOff < chargedDays) {
        return res.status(400).json({ error: "Insufficient comp-off balance" });
      }
      leave.type = type;
      leave.startDate = start.toDate();
      leave.endDate = end.toDate();
      leave.reason = reason;
      leave.isHalfDay = Boolean(isHalfDay);
      leave.halfDayType = isHalfDay ? halfDayType : null;
      leave.workingDates = workingDates;
      leave.chargedDays = chargedDays;
      leave.paidReservedNow = 0;
      leave.paidReservedFuture = 0;
      leave.paidReservationActive = false;
      await leave.save();
    } else {
      // UNPAID
      leave.type = type;
      leave.startDate = start.toDate();
      leave.endDate = end.toDate();
      leave.reason = reason;
      leave.isHalfDay = Boolean(isHalfDay);
      leave.halfDayType = isHalfDay ? halfDayType : null;
      leave.workingDates = workingDates;
      leave.chargedDays = chargedDays;
      leave.paidReservedNow = 0;
      leave.paidReservedFuture = 0;
      leave.paidReservationActive = false;
      await leave.save();
    }

    return res.json({ success: true, data: leave, message: "Leave application updated successfully" });
  } catch (error) {
    console.error("Edit Pending Leave Error:", error);
    return res.status(500).json({ error: error.message || "Failed to update leave" });
  }
};

// Cancel / Delete a pending leave application
// DELETE /api/leave/:id
export const deletePendingLeave = async (req, res) => {
  try {
    const session = req.session;
    const leave = await LeaveApplication.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: "Leave not found" });

    if (leave.status !== LeaveStatus.PENDING) {
      return res.status(400).json({ error: "Only pending leaves can be cancelled" });
    }

    const isAdmin = session.role === "ADMIN";
    const employee = await Employee.findById(leave.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    if (!isAdmin && employee.userId?.toString() !== session.userId) {
      return res.status(403).json({ error: "Unauthorized to cancel this leave application" });
    }

    if (leave.type === LeaveType.PAID && leave.paidReservationActive) {
      await releasePaidLeaveReservation(leave, session.email);
    }

    await LeaveApplication.deleteOne({ _id: leave._id });

    return res.json({ success: true, message: "Leave application cancelled successfully" });
  } catch (error) {
    console.error("Delete Pending Leave Error:", error);
    return res.status(500).json({ error: error.message || "Failed to cancel leave" });
  }
};

// Employee requests to revoke an approved leave
// POST /api/leave/:id/revoke-request
export const requestRevokeLeave = async (req, res) => {
  try {
    const session = req.session;
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Please provide a reason for revoking the leave" });
    }

    const leave = await LeaveApplication.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: "Leave application not found" });

    if (leave.status !== LeaveStatus.APPROVED) {
      return res.status(400).json({
        error: `Only approved leaves can be requested for revocation. Current status: ${leave.status}`,
      });
    }

    const employee = await Employee.findById(leave.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const isAdmin = session.role === "ADMIN";
    if (!isAdmin && employee.userId?.toString() !== session.userId) {
      return res.status(403).json({ error: "Unauthorized to revoke this leave application" });
    }

    // Employees cannot revoke past leaves
    const todayStart = moment.tz(TZ).startOf("day");
    if (!isAdmin && moment(leave.startDate).tz(TZ).isBefore(todayStart)) {
      return res.status(400).json({
        error: "Past leaves cannot be revoked. You can only request revocation for upcoming or active leaves.",
      });
    }

    leave.status = LeaveStatus.REVOKE_REQUESTED;
    leave.revokeReason = reason.trim();
    leave.revokeRequestedAt = new Date();
    leave.revokeRequestedBy = session.email;
    await leave.save();

    // Send email notification to Admin
    try {
      if (process.env.ADMIN_EMAIL) {
        const startStr = moment(leave.startDate).tz(TZ).format("MMM DD, YYYY");
        const endStr = moment(leave.endDate).tz(TZ).format("MMM DD, YYYY");
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        await sendEmail({
          to: process.env.ADMIN_EMAIL,
          subject: `Leave Revocation Request - ${employee.firstName} ${employee.lastName}`,
          body: getEmailTemplate(
            `
<h2 style="margin:0 0 16px; font-size:22px; color:#111827; font-weight:700;">
  Leave Revocation Requested ⚠️
</h2>
<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.7;">
  <strong>${employee.firstName} ${employee.lastName}</strong> has requested to revoke an approved <strong>${leave.type}</strong> leave.
</p>
<div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:14px; padding:18px; margin:20px 0;">
  <p style="margin:0 0 8px; font-size:14px; color:#64748b;"><strong>Leave Period:</strong> ${startStr} to ${endStr} (${leave.chargedDays} days)</p>
  <p style="margin:0; font-size:14px; color:#1e293b;"><strong>Reason for Revocation:</strong> "${reason.trim()}"</p>
</div>
<a href="${frontendUrl}/leave" style="display:inline-block; background:#811c50; color:#ffffff; text-decoration:none; padding:12px 20px; border-radius:10px; font-size:14px; font-weight:600;">
  Review Revocation Request
</a>
            `,
            "Leave Revocation Request",
          ),
        });
      }
    } catch (mailErr) {
      console.error("Failed to send revocation email to admin:", mailErr);
    }

    return res.json({
      success: true,
      data: leave,
      message: "Leave revocation request submitted for Admin approval",
    });
  } catch (error) {
    console.error("Request Revoke Leave Error:", error);
    return res.status(500).json({ error: error.message || "Failed to submit revocation request" });
  }
};

// Admin processes revocation request (APPROVE or REJECT) or directly revokes an approved leave
// PATCH /api/leave/:id/revoke
export const processRevokeLeave = async (req, res) => {
  try {
    const { action, adminComment } = req.body;
    if (!["APPROVE", "REJECT"].includes(action)) {
      return res.status(400).json({ error: "Action must be APPROVE or REJECT" });
    }

    const leave = await LeaveApplication.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: "Leave application not found" });

    if (![LeaveStatus.REVOKE_REQUESTED, LeaveStatus.APPROVED].includes(leave.status)) {
      return res.status(400).json({
        error: `Leave cannot be revoked. Current status is ${leave.status}`,
      });
    }

    const employee = await Employee.findById(leave.employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const startStr = moment(leave.startDate).tz(TZ).format("MMM DD, YYYY");
    const endStr = moment(leave.endDate).tz(TZ).format("MMM DD, YYYY");

    if (action === "APPROVE") {
      const todayStart = moment.tz(TZ).startOf("day");
      if (moment(leave.startDate).tz(TZ).isBefore(todayStart)) {
        return res.status(400).json({
          error: "Past leaves cannot be revoked. Only upcoming or active leaves can be revoked.",
        });
      }

      const refundDays = Number(leave.chargedDays) || 0;

      // 1. Refund employee leave balance
      if (refundDays > 0) {
        if (leave.type === LeaveType.PAID) {
          await Employee.updateOne(
            { _id: employee._id },
            { $inc: { "leaveBalance.paid": refundDays } },
          );
        } else if (leave.type === LeaveType.COMP_OFF) {
          await Employee.updateOne(
            { _id: employee._id },
            { $inc: { "leaveBalance.compOff": refundDays } },
          );
        }
      }

      // 2. Revert Attendance records for this leave
      await revertLeaveAttendance(leave);

      // 3. Mark leave as REVERTED
      const note = adminComment || (leave.revokeReason ? `Revoked upon request: ${leave.revokeReason}` : "Revoked by Admin");
      leave.status = LeaveStatus.REVERTED;
      leave.revertReason = note;
      leave.revertedAt = new Date();
      leave.adminUpdatedAt = new Date();
      leave.revertedDates = leave.workingDates || [];
      await leave.save();

      // 4. Notify employee via email
      try {
        if (employee.email) {
          await sendEmail({
            to: employee.email,
            subject: `Leave Revoked & Balance Refunded`,
            body: getEmailTemplate(
              `
<h2 style="margin:0 0 16px; font-size:22px; color:#111827; font-weight:700;">
  Leave Revocation Confirmed ✅
</h2>
<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.7;">
  Hi ${employee.firstName}, your leave revocation for <strong>${startStr} to ${endStr}</strong> has been approved.
</p>
<div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:14px; padding:18px; margin:20px 0;">
  <p style="margin:0 0 8px; font-size:14px; color:#166534;"><strong>Refunded Balance:</strong> ${refundDays} day(s) restored to your ${leave.type} leave balance.</p>
  <p style="margin:0; font-size:14px; color:#166534;"><strong>Status:</strong> Working schedule restored in attendance.</p>
</div>
              `,
              "Leave Revoked",
            ),
          });
        }
      } catch (mailErr) {
        console.error("Failed to email employee about revocation:", mailErr);
      }

      return res.json({
        success: true,
        data: leave,
        message: `Leave revoked successfully. ${refundDays} day(s) refunded to ${employee.firstName}'s balance.`,
      });
    } else {
      // action === "REJECT" (decline revocation request)
      if (leave.status !== LeaveStatus.REVOKE_REQUESTED) {
        return res.status(400).json({ error: "Cannot decline: Revocation was not requested" });
      }

      leave.status = LeaveStatus.APPROVED;
      await leave.save();

      try {
        if (employee.email) {
          await sendEmail({
            to: employee.email,
            subject: `Leave Revocation Request Declined`,
            body: getEmailTemplate(
              `
<h2 style="margin:0 0 16px; font-size:22px; color:#111827; font-weight:700;">
  Leave Revocation Update
</h2>
<p style="margin:0 0 16px; color:#4b5563; font-size:15px; line-height:1.7;">
  Hi ${employee.firstName}, your request to revoke leave from <strong>${startStr} to ${endStr}</strong> has been declined.
</p>
${adminComment ? `<div style="background:#fef2f2; border:1px solid #fecaca; border-radius:14px; padding:16px; margin:20px 0; color:#991b1b; font-size:14px;"><strong>Admin Note:</strong> ${adminComment}</div>` : ""}
<p style="margin:0; font-size:14px; color:#64748b;">The leave remains in APPROVED status.</p>
              `,
              "Revocation Request Declined",
            ),
          });
        }
      } catch (mailErr) {
        console.error("Failed to email employee about rejected revocation:", mailErr);
      }

      return res.json({
        success: true,
        data: leave,
        message: "Revocation request declined. Leave remains Approved.",
      });
    }
  } catch (error) {
    console.error("Process Revoke Leave Error:", error);
    return res.status(500).json({ error: error.message || "Failed to process leave revocation" });
  }
};

// Admin: Directly create approved leave for an employee
// POST /api/leave/admin
export const adminCreateLeave = async (req, res) => {
  try {
    const {
      employeeId,
      type,
      startDate,
      endDate,
      reason,
      isHalfDay,
      halfDayType,
    } = req.body;

    if (!employeeId || !type || !startDate || !endDate || !reason) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (employee.isDeleted) {
      return res.status(403).json({ error: "Employee account is deactivated" });
    }

    const start = moment.tz(startDate, "YYYY-MM-DD", TZ).startOf("day");
    const end = moment.tz(endDate, "YYYY-MM-DD", TZ).startOf("day");

    if (end.isBefore(start)) {
      return res
        .status(400)
        .json({ error: "End date cannot be before start date" });
    }

    const { workingDates, chargedDays } = await getWorkingLeaveDays({
      startDate,
      endDate,
      isHalfDay: Boolean(isHalfDay),
    });
    if (chargedDays <= 0) {
      return res
        .status(400)
        .json({ error: "Selected dates contain no working days" });
    }

    // Validate balance for COMP_OFF
    if (type === "COMP_OFF") {
      if ((employee.leaveBalance?.compOff || 0) < chargedDays) {
        return res
          .status(400)
          .json({ error: "Insufficient comp-off balance for this employee" });
      }
      employee.leaveBalance.compOff -= chargedDays;
      await employee.save();
    }

    const leave = await LeaveApplication.create({
      employeeId: employee._id,
      type,
      isHalfDay: !!isHalfDay,
      halfDayType: isHalfDay ? halfDayType : null,
      startDate: start.toDate(),
      endDate: end.toDate(),
      workingDates,
      chargedDays,
      reason,
      status: "APPROVED",
      addedBy: req.session.email,
      adminUpdatedAt: new Date(),
    });

    if (type === "PAID") {
      try {
        await reservePaidLeave(leave, employee, workingDates);
        await settlePaidLeaveApproval(leave, req.session.email);
      } catch (error) {
        await LeaveApplication.deleteOne({ _id: leave._id });
        return res.status(400).json({ error: error.message });
      }
    }

    // Sync with Attendance
    await syncLeaveWithAttendance(leave, req.session.email);

    return res.json({ success: true, data: leave });
  } catch (error) {
    console.error("Admin Create Leave Error:", error);
    return res.status(500).json({ error: "Failed to create leave" });
  }
};

// GET /api/leave/today — employees on leave today (admin only)
export const getOnLeaveToday = async (req, res) => {
  try {
    const now = moment.tz(TZ);
    const todayStart = now.clone().startOf("day").toDate();
    const todayEnd = now.clone().endOf("day").toDate();

    const leaves = await LeaveApplication.find({
      status: "APPROVED",
      startDate: { $lte: todayEnd },
      endDate: { $gte: todayStart },
    }).populate({
      path: "employeeId",
      select: "firstName lastName position profile_img departmentName",
    });

    const result = leaves
      .filter((l) => l.employeeId) // skip orphaned records
      .map((l) => ({
        id: l._id,
        employeeId: l.employeeId._id,
        firstName: l.employeeId.firstName,
        lastName: l.employeeId.lastName,
        position: l.employeeId.position,
        departmentName: l.employeeId.departmentName,
        profile_img: l.employeeId.profile_img,
        type: l.type,
        isHalfDay: l.isHalfDay,
        halfDayType: l.halfDayType,
        startDate: l.startDate,
        endDate: l.endDate,
        reason: l.reason,
      }));

    return res.json({ success: true, count: result.length, data: result });
  } catch (error) {
    console.error("Get On Leave Today Error:", error);
    return res
      .status(500)
      .json({ error: "Failed to fetch today's leave list" });
  }
};

// GET /api/leave/calendar?month=YYYY-MM — monthly leave calendar data with leaves and holidays
export const getLeaveCalendar = async (req, res) => {
  try {
    const session = req.session;
    const isAdmin = session.role === "ADMIN";
    const requestedMonth = req.query.month; // e.g. "2026-10"

    const baseDate = requestedMonth
      ? moment.tz(requestedMonth, "YYYY-MM", TZ)
      : moment.tz(TZ);

    const monthStart = baseDate.clone().startOf("month").startOf("day").toDate();
    const monthEnd = baseDate.clone().endOf("month").endOf("day").toDate();

    const query = {
      startDate: { $lte: monthEnd },
      endDate: { $gte: monthStart },
    };

    if (!isAdmin) {
      const employee = await Employee.findOne({ userId: session.userId });
      if (!employee) return res.status(404).json({ error: "Employee not found" });
      query.employeeId = employee._id;
    }

    const [leaves, holidays, overrides] = await Promise.all([
      LeaveApplication.find(query)
        .populate({
          path: "employeeId",
          select: "firstName lastName position profile_img department",
          populate: { path: "department", select: "name" },
        })
        .sort({ startDate: 1 })
        .lean(),
      Holiday.find({
        date: { $gte: monthStart, $lte: monthEnd },
      })
        .sort({ date: 1 })
        .lean(),
      CalendarOverride.find({
        $or: [
          { date: { $gte: monthStart, $lte: monthEnd } },
          { swapDate: { $gte: monthStart, $lte: monthEnd } },
        ],
      })
        .sort({ date: 1 })
        .lean(),
    ]);

    const formattedLeaves = leaves
      .filter((l) => l.employeeId)
      .map((l) => ({
        id: l._id.toString(),
        employeeId: l.employeeId?._id?.toString(),
        firstName: l.employeeId?.firstName || "Unknown",
        lastName: l.employeeId?.lastName || "",
        fullName: `${l.employeeId?.firstName || ""} ${l.employeeId?.lastName || ""}`.trim(),
        position: l.employeeId?.position || "Employee",
        departmentName: l.employeeId?.department?.name || "General",
        profile_img: l.employeeId?.profile_img || "",
        type: l.type,
        status: l.status,
        isHalfDay: Boolean(l.isHalfDay),
        halfDayType: l.halfDayType,
        startDate: moment(l.startDate).tz(TZ).format("YYYY-MM-DD"),
        endDate: moment(l.endDate).tz(TZ).format("YYYY-MM-DD"),
        rawStartDate: l.startDate,
        rawEndDate: l.endDate,
        workingDates: l.workingDates || [],
        revertedDates: l.revertedDates || [],
        revertReason: l.revertReason || null,
        revertedAt: l.revertedAt || null,
        chargedDays: l.chargedDays ?? 1,
        reason: l.reason,
        addedBy: l.addedBy || null,
        adminUpdatedAt: l.adminUpdatedAt || null,
        createdAt: l.createdAt,
      }));

    // Calculate quick stats for the month
    const approvedCount = formattedLeaves.filter(
      (l) => l.status === LeaveStatus.APPROVED,
    ).length;
    const pendingCount = formattedLeaves.filter(
      (l) => l.status === LeaveStatus.PENDING,
    ).length;
    const onLeaveTodayCount = formattedLeaves.filter((l) => {
      if (l.status !== LeaveStatus.APPROVED) return false;
      const s = moment(l.startDate).tz(TZ).startOf("day");
      const e = moment(l.endDate).tz(TZ).endOf("day");
      const t = moment.tz(TZ);
      return t.isBetween(s, e, null, "[]");
    }).length;

    const formattedHolidays = holidays.map((h) => ({
      id: h._id.toString(),
      name: h.name,
      date: moment(h.date).tz(TZ).format("YYYY-MM-DD"),
      year: h.year,
    }));

    const formattedOverrides = overrides.map((o) => ({
      id: o._id.toString(),
      type: o.type,
      title: o.title,
      reason: o.reason,
      date: moment(o.date).tz(TZ).format("YYYY-MM-DD"),
      swapDate: o.swapDate ? moment(o.swapDate).tz(TZ).format("YYYY-MM-DD") : null,
      year: o.year,
      affectedLeavesCount: o.affectedLeaves?.length || 0,
    }));

    return res.json({
      success: true,
      month: baseDate.format("YYYY-MM"),
      leaves: formattedLeaves,
      holidays: formattedHolidays,
      overrides: formattedOverrides,
      stats: {
        totalLeaves: formattedLeaves.length,
        approvedCount,
        pendingCount,
        onLeaveTodayCount,
      },
    });
  } catch (error) {
    console.error("Get Leave Calendar Error:", error);
    return res.status(500).json({ error: "Failed to fetch leave calendar" });
  }
};

// GET /api/leave/calculate-days?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&isHalfDay=false
export const calculateLeaveDays = async (req, res) => {
  try {
    const { startDate, endDate, isHalfDay } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }

    const isHalf = isHalfDay === "true" || isHalfDay === true;
    const { workingDates, chargedDays } = await getWorkingLeaveDays({
      startDate,
      endDate,
      isHalfDay: isHalf,
    });

    const start = moment.tz(startDate, "YYYY-MM-DD", TZ).startOf("day");
    const end = moment.tz(endDate, "YYYY-MM-DD", TZ).startOf("day");
    const totalSpan = isHalf
      ? 0.5
      : Math.round(end.diff(start, "days")) + 1;

    const excludedDays = Math.max(0, totalSpan - chargedDays);

    return res.json({
      success: true,
      totalSpan,
      chargedDays,
      excludedDays,
      workingDates: workingDates.map((d) => moment(d).tz(TZ).format("YYYY-MM-DD")),
      isHalfDay: isHalf,
    });
  } catch (error) {
    console.error("Calculate Leave Days Error:", error);
    return res.status(400).json({ error: error.message || "Failed to calculate leave days" });
  }
};


