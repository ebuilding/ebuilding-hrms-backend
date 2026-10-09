import moment from "moment-timezone";
import { inngest } from "../inngest/index.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Attendance from "../models/Attendance.js";
import { getWorkingLeaveDays } from "../utils/leaveDays.js";
import {
  processPaidLeaveGrants,
  releasePaidLeaveReservation,
  reservePaidLeave,
  settlePaidLeaveApproval,
} from "../utils/paidLeave.js";

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

  for (const workingDate of workingDates) {
    const dateStart = moment(workingDate).tz(TZ).startOf("day").toDate();
    const dateEnd = moment(workingDate).tz(TZ).endOf("day").toDate();

    let attendanceRecord = await Attendance.findOne({
      employeeId: leave.employeeId,
      date: { $gte: dateStart, $lte: dateEnd },
    });

    if (attendanceRecord) {
      attendanceRecord.status = "LEAVE";
      attendanceRecord.dayType = leave.isHalfDay ? "Half Day" : "Full Day";
      attendanceRecord.checkIn = null;
      attendanceRecord.checkOut = null;
      attendanceRecord.workingHours = null;
      attendanceRecord.updatedBy = adminEmail || "System";
      attendanceRecord.adminUpdatedAt = new Date();
      await attendanceRecord.save();
    } else {
      await Attendance.create({
        employeeId: leave.employeeId,
        date: dateStart,
        status: "LEAVE",
        dayType: leave.isHalfDay ? "Half Day" : "Full Day",
        checkIn: null,
        checkOut: null,
        workingHours: null,
        updatedBy: adminEmail || "System",
        adminUpdatedAt: new Date(),
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

    if (start.isSameOrBefore(today) || end.isSameOrBefore(today)) {
      return res
        .status(400)
        .json({ error: "Leave dates must be in the future" });
    }

    if (end.isBefore(start)) {
      return res
        .status(400)
        .json({ error: "End date cannot be before start date" });
    }

    if (!["PAID", "UNPAID", "COMP_OFF"].includes(type)) {
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

    if (type === "COMP_OFF") {
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
      status: "PENDING",
    });

    if (type === "PAID") {
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
    if (isAdmin) {
      const status = req.query.status;
      const where = status ? { status } : {};
      const leaves = await LeaveApplication.find(where)
        .select("type status startDate endDate reason isHalfDay halfDayType chargedDays createdAt employeeId")
        .populate({
          path: "employeeId",
          select: "firstName lastName department",
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
      return res.json({ data });
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
        .select("type status startDate endDate reason isHalfDay halfDayType chargedDays createdAt")
        .sort({ createdAt: -1 })
        .lean();
      return res.json({
        data: leaves,
        employee: { ...employee, id: employee._id.toString() },
      });
    }
  } catch (error) {
    return res.status(500).json({ error: "Failed" });
  }
};

// Update leave status
// PATCH /api/leaves/:id
export const updateLeaveStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const leave = await LeaveApplication.findById(req.params.id);
    if (!leave) return res.status(404).json({ error: "Leave not found" });

    // If status is changing to APPROVED, deduct balance
    if (status === "APPROVED" && leave.status !== "APPROVED") {
      const employee = await Employee.findById(leave.employeeId);
      if (!employee)
        return res.status(404).json({ error: "Employee not found" });

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
    }

    // Revert synced Attendance records if leave status changes from APPROVED to something else
    if (leave.status === "APPROVED" && status !== "APPROVED") {
      await revertLeaveAttendance(leave);
    }

    leave.status = status;
    await leave.save();

    return res.json({ success: true, data: leave });
  } catch (error) {
    return res.status(500).json({ error: "Failed" });
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
