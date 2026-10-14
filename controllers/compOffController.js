import moment from "moment-timezone";
import CompOffRequest from "../models/CompOffRequest.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import { UserRole, CompOffRequestStatus } from "../constants/enums.js";
import { creditCompOffForAttendance } from "../utils/compOff.js";

const TZ = "Asia/Kolkata";

/**
 * EMPLOYEE: Get eligible worked non-working days (Sundays / Holidays)
 * that have not yet been requested or credited.
 * GET /api/compoff/eligible-days
 */
export const getEligibleDays = async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // 1. Fetch all attendance records on non-working days with completed checkIn/checkOut
    const workedDays = await Attendance.find({
      employeeId: employee._id,
      compoffFor: { $in: ["Week Off", "Holiday", "Other"] },
      checkIn: { $ne: null },
      checkOut: { $ne: null },
      workingHours: { $gte: 4 },
      compOffCredited: { $ne: true },
    })
      .sort({ date: -1 })
      .lean();

    // 2. Fetch existing CompOffRequests that are PENDING or APPROVED
    const activeRequests = await CompOffRequest.find({
      employeeId: employee._id,
      status: { $in: [CompOffRequestStatus.PENDING, CompOffRequestStatus.APPROVED] },
    })
      .select("attendanceId")
      .lean();

    const activeAttendanceIds = new Set(
      activeRequests.map((r) => r.attendanceId.toString())
    );

    // 3. Filter out days that already have active requests
    const eligibleDays = workedDays
      .filter((day) => !activeAttendanceIds.has(day._id.toString()))
      .map((day) => {
        const dateFormatted = moment(day.date).tz(TZ).format("MMM D, YYYY");
        const dayName = moment(day.date).tz(TZ).format("dddd");
        const hours = day.workingHours || 0;
        const creditedDays = hours >= 8 ? 1 : 0.5;
        const dayType = creditedDays === 1 ? "Full Day" : "Half Day";

        return {
          attendanceId: day._id,
          date: day.date,
          dateFormatted,
          dayName,
          checkIn: day.checkIn,
          checkOut: day.checkOut,
          workingHours: hours,
          dayType,
          creditedDays,
          compoffFor: day.compoffFor || "Week Off",
          displayLabel: `${dateFormatted} - ${dayName} (${day.compoffFor || "Week Off"}) • ${hours} hrs → ${creditedDays} Day Credit`,
        };
      });

    return res.json({ success: true, data: eligibleDays });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * EMPLOYEE: Submit a new Comp-Off Request
 * POST /api/compoff/request
 */
export const requestCompOff = async (req, res) => {
  try {
    const { attendanceId, reason } = req.body;

    if (!attendanceId) {
      return res.status(400).json({ error: "Please select an eligible worked day" });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Please provide a reason or work description" });
    }

    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const attendance = await Attendance.findOne({
      _id: attendanceId,
      employeeId: employee._id,
    });

    if (!attendance) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    if (!attendance.checkIn || !attendance.checkOut) {
      return res.status(400).json({ error: "Selected day has incomplete check-in/out records" });
    }

    if (!attendance.workingHours || attendance.workingHours < 4) {
      return res.status(400).json({ error: "A minimum of 4 working hours is required to claim comp-off" });
    }

    if (attendance.compOffCredited) {
      return res.status(400).json({ error: "Comp-off has already been credited for this day" });
    }

    // Check for existing pending or approved request
    const existing = await CompOffRequest.findOne({
      employeeId: employee._id,
      attendanceId: attendance._id,
      status: { $in: [CompOffRequestStatus.PENDING, CompOffRequestStatus.APPROVED] },
    });

    if (existing) {
      return res.status(400).json({
        error:
          existing.status === CompOffRequestStatus.PENDING
            ? "A comp-off request for this date is already awaiting review"
            : "Comp-off has already been approved for this date",
      });
    }

    const hours = attendance.workingHours || 0;
    const creditedDays = hours >= 8 ? 1 : 0.5;
    const dayType = creditedDays === 1 ? "Full Day" : "Half Day";

    const compOffReq = await CompOffRequest.create({
      employeeId: employee._id,
      attendanceId: attendance._id,
      workedDate: attendance.date,
      workedHours: hours,
      dayType,
      creditedDays,
      compoffFor: attendance.compoffFor || "Week Off",
      reason: reason.trim(),
      status: CompOffRequestStatus.PENDING,
    });

    return res.status(201).json({
      success: true,
      message: "Comp-off request submitted successfully for administrator approval",
      data: compOffReq,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * ADMIN & EMPLOYEE: Get Comp-Off Requests
 * GET /api/compoff/requests
 */
export const getCompOffRequests = async (req, res) => {
  try {
    const session = req.session;
    const { status } = req.query;

    let query = {};

    if (status && Object.values(CompOffRequestStatus).includes(status)) {
      query.status = status;
    }

    if (session.role === UserRole.ADMIN) {
      // Admin sees all employee requests
      const requests = await CompOffRequest.find(query)
        .populate({
          path: "employeeId",
          select: "firstName lastName email profile_img department position",
          populate: { path: "department", select: "name" },
        })
        .populate("reviewedBy", "email")
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: requests });
    } else {
      // Employee sees only their own requests
      const employee = await Employee.findOne({ userId: session.userId });
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      query.employeeId = employee._id;

      const requests = await CompOffRequest.find(query)
        .populate("reviewedBy", "email")
        .sort({ createdAt: -1 })
        .lean();

      return res.json({ success: true, data: requests });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * ADMIN: Approve Comp-Off Request
 * PATCH /api/compoff/requests/:id/approve
 */
export const approveCompOffRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await CompOffRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: "Comp-off request not found" });
    }

    if (request.status !== CompOffRequestStatus.PENDING) {
      return res.status(400).json({
        error: `Cannot approve request that is already ${request.status.toLowerCase()}`,
      });
    }

    // 1. Credit the comp-off via attendance utility (idempotent, updates employee balance)
    const creditResult = await creditCompOffForAttendance(request.attendanceId);

    // 2. Mark request as approved
    request.status = CompOffRequestStatus.APPROVED;
    request.reviewedBy = req.session.userId;
    request.reviewedAt = new Date();
    request.rejectionReason = null;
    await request.save();

    return res.json({
      success: true,
      message: `Comp-off request approved. +${request.creditedDays} day credited to employee balance.`,
      data: request,
      balanceAfter: creditResult.balanceAfter,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

/**
 * ADMIN: Reject Comp-Off Request
 * PATCH /api/compoff/requests/:id/reject
 */
export const rejectCompOffRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!rejectionReason || !rejectionReason.trim()) {
      return res.status(400).json({ error: "Please provide a rejection reason" });
    }

    const request = await CompOffRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: "Comp-off request not found" });
    }

    if (request.status !== CompOffRequestStatus.PENDING) {
      return res.status(400).json({
        error: `Cannot reject request that is already ${request.status.toLowerCase()}`,
      });
    }

    request.status = CompOffRequestStatus.REJECTED;
    request.rejectionReason = rejectionReason.trim();
    request.reviewedBy = req.session.userId;
    request.reviewedAt = new Date();
    await request.save();

    return res.json({
      success: true,
      message: "Comp-off request rejected.",
      data: request,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
