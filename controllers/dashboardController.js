import moment from "moment-timezone";
import Department from "../models/Department.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Payslip from "../models/Payslip.js";
import { processPaidLeaveGrants } from "../utils/paidLeave.js";
import { AttendanceStatus } from "../constants/enums.js";

import RegistrationInvite from "../models/RegistrationInvite.js";
import { getCelebrationsData } from "../utils/celebrations.js";
import {
  getAttendanceShiftConfig,
  calculateLateArrival,
  calculateMonthWorkingDaysAndTarget,
} from "../utils/shiftConfig.js";

const TZ = "Asia/Kolkata";

// Get dashboard for employee and admin
// GET /api/dashboard
export const getDashboard = async (req, res) => {
  try {
    const session = req.session;
    if (session.role === "ADMIN") {
      const todayStart = moment.tz(TZ).startOf("day").toDate();
      const todayEnd = moment.tz(TZ).endOf("day").toDate();
      const thirtyDaysAgo = moment.tz(TZ).subtract(30, "days").startOf("day").toDate();

      const [
        allActiveEmployees,
        todayApprovedLeaves,
        pendingLeavesCount,
        totalDepartments,
        departmentStats,
        leaveStats,
        recentLeaves,
        celebrations,
        todayAttendanceRecords,
        missingPunchOuts,
        allInvites,
      ] = await Promise.all([
        Employee.find({ isDeleted: { $ne: true } })
          .populate("department", "name")
          .select("firstName lastName position department profile_img email")
          .lean(),
        LeaveApplication.find({
          status: "APPROVED",
          startDate: { $lte: todayEnd },
          endDate: { $gte: todayStart },
        }).lean(),
        LeaveApplication.countDocuments({ status: "PENDING" }),
        Department.countDocuments(),
        // Department Distribution
        Employee.aggregate([
          { $match: { isDeleted: { $ne: true } } },
          { $group: { _id: "$department", count: { $sum: 1 } } },
          {
            $lookup: {
              from: "departments",
              localField: "_id",
              foreignField: "_id",
              as: "deptInfo",
            },
          },
          { $unwind: { path: "$deptInfo", preserveNullAndEmptyArrays: true } },
          {
            $project: {
              name: { $ifNull: ["$deptInfo.name", "Unassigned"] },
              value: "$count",
            },
          },
        ]),
        // Leave Type Stats (Approved/Pending in last 30 days)
        LeaveApplication.aggregate([
          {
            $match: {
              createdAt: {
                $gte: moment.tz(TZ).subtract(30, "days").toDate(),
              },
            },
          },
          { $group: { _id: "$type", count: { $sum: 1 } } },
        ]),
        // Recent Leave Applications
        LeaveApplication.find({ status: "PENDING" })
          .populate("employeeId", "firstName lastName")
          .sort({ createdAt: -1 })
          .limit(5)
          .lean(),
        // Celebrations (Birthdays & Anniversaries)
        getCelebrationsData(30),
        // Today's attendance records with punch-in
        Attendance.find({
          date: { $gte: todayStart, $lte: todayEnd },
          checkIn: { $ne: null },
        })
          .populate({
            path: "employeeId",
            select: "firstName lastName position profile_img department",
            populate: { path: "department", select: "name" },
          })
          .lean(),
        // Missing punch-outs or auto punch-outs from previous 30 days
        Attendance.find({
          date: { $lt: todayStart, $gte: thirtyDaysAgo },
          checkIn: { $ne: null },
          $or: [{ checkOut: null }, { updatedBy: "System" }],
        })
          .populate({
            path: "employeeId",
            select: "firstName lastName position profile_img department",
            populate: { path: "department", select: "name" },
          })
          .sort({ date: -1 })
          .limit(8)
          .lean(),
        // Registration invites & candidate submissions
        RegistrationInvite.find()
          .populate("department", "name")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
      ]);

      const totalEmployees = allActiveEmployees.length;
      const onLeaveEmployeeIds = new Set(
        todayApprovedLeaves.map((l) => l.employeeId?.toString()).filter(Boolean),
      );
      const onLeaveCount = onLeaveEmployeeIds.size;

      const todayAttendanceMap = new Map(
        todayAttendanceRecords.map((r) => [
          r.employeeId?._id?.toString() || r.employeeId?.toString(),
          r,
        ]),
      );

      // Fetch dynamic shift config (shift start + grace period)
      const shiftConfig = await getAttendanceShiftConfig();

      // List of employees who punched in today
      const punchedInList = todayAttendanceRecords
        .filter((rec) => rec.employeeId && rec.checkIn)
        .map((rec) => {
          const mIn = moment(rec.checkIn).tz(TZ);
          const mOut = rec.checkOut ? moment(rec.checkOut).tz(TZ) : null;
          const lateInfo = calculateLateArrival(rec.checkIn, shiftConfig);
          return {
            id: rec._id,
            employeeId: rec.employeeId._id,
            name: `${rec.employeeId.firstName || ""} ${rec.employeeId.lastName || ""}`.trim(),
            position: rec.employeeId.position || "Employee",
            department: rec.employeeId.department?.name || "General",
            profile_img: rec.employeeId.profile_img || "",
            checkInTime: mIn.format("hh:mm A"),
            checkOutTime: mOut ? mOut.format("hh:mm A") : null,
            isLate: lateInfo.isLate,
            lateMinutes: lateInfo.lateMinutes,
            minutesFromShiftStart: lateInfo.minutesFromShiftStart,
            graceMinutes: lateInfo.graceMinutes,
            scheduledStartTime: lateInfo.scheduledStartTime,
            graceThresholdTime: lateInfo.graceThresholdTime,
            status: rec.status,
          };
        });

      // List of employees who have NOT punched in today
      const notPunchedInList = allActiveEmployees
        .filter((emp) => !todayAttendanceMap.has(emp._id.toString()))
        .map((emp) => {
          const isOnLeave = onLeaveEmployeeIds.has(emp._id.toString());
          return {
            id: emp._id,
            employeeId: emp._id,
            name: `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
            position: emp.position || "Employee",
            department: emp.department?.name || "General",
            profile_img: emp.profile_img || "",
            status: isOnLeave ? "On Leave" : "Not Marked",
            isOnLeave,
          };
        });

      const todayAttendanceCount = punchedInList.length;
      const notMarkedCount = Math.max(0, totalEmployees - todayAttendanceCount - onLeaveCount);

      const attendanceDistribution = [
        { name: "Present", value: todayAttendanceCount, color: "#10b981" },
        { name: "On Leave", value: onLeaveCount, color: "#f59e0b" },
        { name: "Not Marked", value: notMarkedCount, color: "#ef4444" },
      ];

      // Attendance Trend (Last 7 days)
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        last7Days.push(moment.tz(TZ).subtract(i, "days").startOf("day"));
      }

      const attendanceTrend = await Promise.all(
        last7Days.map(async (mDate) => {
          const dateStart = mDate.toDate();
          const dateEnd = mDate.clone().endOf("day").toDate();
          const count = await Attendance.countDocuments({
            date: { $gte: dateStart, $lte: dateEnd },
            status: { $in: [AttendanceStatus.PRESENT, AttendanceStatus.HALF_DAY] },
          });
          return {
            date: mDate.format("MMM DD"),
            count,
          };
        }),
      );

      // Process late arrivals dynamically using shiftConfig (shift start + grace period)
      const lateArrivals = todayAttendanceRecords
        .filter((rec) => {
          if (!rec.checkIn || !rec.employeeId) return false;
          const { isLate } = calculateLateArrival(rec.checkIn, shiftConfig);
          return isLate;
        })
        .map((rec) => {
          const m = moment(rec.checkIn).tz(TZ);
          const lateInfo = calculateLateArrival(rec.checkIn, shiftConfig);
          return {
            id: rec._id,
            employeeId: rec.employeeId?._id,
            name: `${rec.employeeId?.firstName || ""} ${rec.employeeId?.lastName || ""}`.trim(),
            position: rec.employeeId?.position || "Employee",
            department: rec.employeeId?.department?.name || "General",
            profile_img: rec.employeeId?.profile_img || "",
            checkInTime: m.format("hh:mm A"),
            lateMinutes: lateInfo.lateMinutes,
            minutesFromShiftStart: lateInfo.minutesFromShiftStart,
            graceMinutes: lateInfo.graceMinutes,
            scheduledStartTime: lateInfo.scheduledStartTime,
            graceThresholdTime: lateInfo.graceThresholdTime,
          };
        });

      // Format missing punch-outs
      const formattedMissing = missingPunchOuts
        .filter((rec) => rec.employeeId)
        .map((rec) => ({
          id: rec._id,
          employeeId: rec.employeeId?._id,
          name: `${rec.employeeId?.firstName || ""} ${rec.employeeId?.lastName || ""}`.trim(),
          position: rec.employeeId?.position || "Employee",
          department: rec.employeeId?.department?.name || "General",
          profile_img: rec.employeeId?.profile_img || "",
          dateStr: moment(rec.date).tz(TZ).format("MMM DD"),
          checkInTime: rec.checkIn ? moment(rec.checkIn).tz(TZ).format("hh:mm A") : "—",
          reason: !rec.checkOut ? "Missing Check-Out" : "Auto Clocked Out",
        }));

      // Process pending candidate submissions from invites
      let pendingCandidates = [];
      for (const inv of (allInvites || [])) {
        for (const sub of (inv.submissions || [])) {
          if (sub.approvalStatus === "PENDING" && sub.employeeId) {
            pendingCandidates.push({
              inviteId: inv._id,
              employeeId: sub.employeeId,
              submittedAt: sub.submittedAt,
            });
          }
        }
      }

      if (pendingCandidates.length > 0) {
        const empIds = pendingCandidates.map((c) => c.employeeId);
        const emps = await Employee.find({ _id: { $in: empIds } })
          .populate("department", "name")
          .select("firstName lastName email position department profile_img createdAt")
          .lean();
        const empMap = new Map(emps.map((e) => [e._id.toString(), e]));

        pendingCandidates = pendingCandidates.map((c) => {
          const emp = empMap.get(c.employeeId.toString());
          return {
            ...c,
            candidateName: emp ? `${emp.firstName} ${emp.lastName}`.trim() : "New Candidate",
            candidateEmail: emp?.email || "",
            candidatePosition: emp?.position || "Candidate",
            candidateDepartment: emp?.department?.name || "General",
            candidateProfileImg: emp?.profile_img || "",
          };
        });
      }

      const activeInviteLinks = (allInvites || [])
        .filter((inv) => inv.isActive && new Date(inv.expiresAt) > new Date())
        .map((inv) => ({
          id: inv._id,
          label: inv.label || "General Registration",
          token: inv.token,
          expiresAt: inv.expiresAt,
          usedCount: inv.usedCount,
          maxUses: inv.maxUses,
          department: inv.department?.name || "All Departments",
        }));

      return res.json({
        role: "ADMIN",
        totalEmployees,
        totalDepartments: totalDepartments,
        todayAttendance: todayAttendanceCount,
        pendingLeaves: pendingLeavesCount,
        charts: {
          departmentStats: departmentStats.map((d) => ({
            name: d.name,
            value: d.value,
          })),
          attendanceDistribution,
          leaveStats: leaveStats.map((l) => ({
            name: l._id,
            value: l.count,
          })),
          attendanceTrend,
        },
        recentLeaves: recentLeaves.map((l) => ({
          id: l._id,
          employeeName: `${l.employeeId?.firstName} ${l.employeeId?.lastName}`,
          type: l.type,
          startDate: l.startDate,
          endDate: l.endDate,
          status: l.status,
        })),
        celebrations: celebrations || { today: [], upcoming: [] },
        attendanceWatchlist: {
          totalEmployees,
          punchedInCount: punchedInList.length,
          notPunchedInCount: notPunchedInList.length,
          onLeaveCount,
          punchedInList,
          notPunchedInList,
          lateArrivals,
          missingPunchOuts: formattedMissing,
        },
        pendingInvites: {
          pendingCandidates,
          activeInviteLinks,
          totalPending: pendingCandidates.length,
        },
      });
    } else {
      let employee = await Employee.findOne({
        userId: session.userId,
      })
        .populate("department", "name")
        .lean();
      if (!employee)
        return res.status(404).json({ error: "Employee not found" });

      // Process any pending grants dynamically before sending to UI
      await processPaidLeaveGrants(employee._id);
      employee = await Employee.findOne({ userId: session.userId })
        .populate("department", "name")
        .select("-bankDetails -personalInfo -documents")
        .lean();


      const now = moment.tz(TZ);
      const startOfMonth = now.clone().startOf("month").toDate();
      const endOfMonth = now.clone().endOf("month").toDate();

      const todayStart = moment.tz(TZ).startOf("day").toDate();
      const todayEnd = moment.tz(TZ).endOf("day").toDate();

      // Fetch shift configuration and calculate monthly target hours
      const shiftConfig = await getAttendanceShiftConfig();
      const customDailyHours =
        employee.customShiftEnabled && employee.shiftHours && employee.shiftHours > 0
          ? employee.shiftHours
          : null;
      const { workingDaysCount, dailyHours, targetHours } =
        await calculateMonthWorkingDaysAndTarget(now, shiftConfig, customDailyHours);

      const [
        monthAttendances,
        pendingLeaves,
        latestPayslip,
        todayRecord,
        nonWorkingDaysCount,
      ] = await Promise.all([
        Attendance.find({
          employeeId: employee._id,
          date: { $gte: startOfMonth, $lte: endOfMonth },
        }).lean(),
        LeaveApplication.countDocuments({
          employeeId: employee._id,
          status: "PENDING",
        }),
        Payslip.findOne({ employeeId: employee._id })
          .sort({ createdAt: -1 })
          .lean(),
        Attendance.findOne({
          employeeId: employee._id,
          date: { $gte: todayStart, $lte: todayEnd },
        }).lean(),
        Attendance.countDocuments({
          employeeId: employee._id,
          date: { $gte: startOfMonth, $lte: todayEnd },
          status: { $in: ["WEEK_OFF", "HOLIDAY"] },
        }),
      ]);

      // Calculate total worked minutes and present credit identically to attendanceReport
      let totalMinutesWorked = 0;
      let presentDaysCount = 0;
      const minFullMinutes = ((Number(shiftConfig.minHoursForFullDay) || 4) * 60);

      for (const att of monthAttendances) {
        let dayMinutes = 0;
        if (typeof att.workingHours === "number" && !isNaN(att.workingHours)) {
          dayMinutes = Math.round(att.workingHours * 60);
        } else if (att.checkIn && att.checkOut) {
          dayMinutes = Math.max(
            0,
            Math.round((new Date(att.checkOut) - new Date(att.checkIn)) / 60000),
          );
        }

        if (dayMinutes > 0) {
          totalMinutesWorked += dayMinutes;
          presentDaysCount += dayMinutes >= minFullMinutes ? 1 : 0.5;
        } else if (att.status === AttendanceStatus.PRESENT) {
          presentDaysCount += 1;
        } else if (att.status === AttendanceStatus.HALF_DAY) {
          presentDaysCount += 0.5;
        }
      }

      // January Allowance Logic (Jan 15 - Jan 20)
      let januaryAllowance = null;
      if (now.month() === 0 && now.date() >= 15 && now.date() <= 20) {
        const salaryPerDay = (employee.basicSalary || 0) / 31;
        const totalRemaining = employee.leaveBalance?.lastYearRemaining || 0;
        if (totalRemaining > 0) {
          januaryAllowance = {
            amount: parseFloat((salaryPerDay * totalRemaining).toFixed(2)),
            leaves: totalRemaining,
          };
        }
      }

      const totalHoursWorked = parseFloat((totalMinutesWorked / 60).toFixed(2));
      const targetMonthHours = targetHours;
      const hoursProgressPercentage =
        targetMonthHours > 0
          ? Math.min(
            100,
            parseFloat(((totalHoursWorked / targetMonthHours) * 100).toFixed(1)),
          )
          : 0;
      const remainingHours = Math.max(
        0,
        parseFloat((targetMonthHours - totalHoursWorked).toFixed(2)),
      );

      // Calculate Expected Working Days
      const daysPassed = now.date();
      const expectedWorkingDays = Math.max(1, daysPassed - nonWorkingDaysCount);
      const calculatedPercentage =
        Math.round((presentDaysCount / expectedWorkingDays) * 100) || 0;

      return res.json({
        role: "EMPLOYEE",
        employee: { ...employee, id: employee._id.toString() },
        shiftConfig,
        stats: {
          currentMonthAttendance: presentDaysCount,
          pendingLeaves,
          totalHours: totalHoursWorked,
          targetMonthHours,
          workingDaysInMonth: workingDaysCount,
          dailyShiftHours: dailyHours,
          hoursProgressPercentage,
          remainingHours,
          minHoursForFullDay: shiftConfig.minHoursForFullDay,
          shiftPolicyNote: `If any day has fewer hours, you can make up the hours on other days to complete your target monthly hours. Days with ${shiftConfig.minHoursForFullDay || 4}+ hours count as present.`,
          attendancePercentage: Math.min(100, calculatedPercentage),
        },
        todayRecord,
        januaryAllowance,
        latestPayslip: latestPayslip
          ? { ...latestPayslip, id: latestPayslip._id.toString() }
          : null,
      });
    }
  } catch (error) {
    console.error("Dashboard error:", error);
    return res.status(500).json({ error: "Failed" });
  }
};

