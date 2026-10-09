import moment from "moment-timezone";
import Department from "../models/Department.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Payslip from "../models/Payslip.js";
import Holiday from "../models/Holiday.js";
import { processPaidLeaveGrants } from "../utils/paidLeave.js";

const TZ = "Asia/Kolkata";

// Get dashboard for employee and admin
// GET /api/dashboard
export const getDashboard = async (req, res) => {
  try {
    const session = req.session;
    if (session.role === "ADMIN") {
      const todayStart = moment.tz(TZ).startOf("day").toDate();
      const todayEnd = moment.tz(TZ).endOf("day").toDate();

      const [
        totalEmployees,
        todayAttendanceCount,
        pendingLeavesCount,
        totalDepartments,
        departmentStats,
        attendanceDistribution,
        leaveStats,
        recentLeaves,
      ] = await Promise.all([
        Employee.countDocuments({ isDeleted: { $ne: true } }),
        Attendance.countDocuments({
          date: { $gte: todayStart, $lte: todayEnd },
          status: { $in: ["PRESENT", "HALF_DAY"] },
        }),
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
        // Today's Attendance Distribution
        Attendance.aggregate([
          { $match: { date: { $gte: todayStart, $lte: todayEnd } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
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
      ]);

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
            status: { $in: ["PRESENT", "HALF_DAY"] },
          });
          return {
            date: mDate.format("MMM DD"),
            count,
          };
        }),
      );

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
          attendanceDistribution: attendanceDistribution.map((a) => ({
            name: a._id,
            value: a.count,
          })),
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

      const [
        currentMonthAttendance,
        pendingLeaves,
        latestPayslip,
        todayRecord,
        nonWorkingDaysCount,
      ] = await Promise.all([
        Attendance.countDocuments({
          employeeId: employee._id,
          date: { $gte: startOfMonth, $lte: endOfMonth },
          status: { $in: ["PRESENT", "HALF_DAY"] },
        }),
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

      // Simple stats aggregation
      const monthlyStats = await Attendance.aggregate([
        {
          $match: {
            employeeId: employee._id,
            date: { $gte: startOfMonth, $lte: endOfMonth },
            status: { $in: ["PRESENT", "HALF_DAY"] },
          },
        },
        {
          $group: {
            _id: null,
            totalHours: { $sum: "$workingHours" },
          },
        },
      ]);

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

      // Calculate Expected Working Days
      const daysPassed = now.date();
      const expectedWorkingDays = Math.max(1, daysPassed - nonWorkingDaysCount);
      const calculatedPercentage =
        Math.round((currentMonthAttendance / expectedWorkingDays) * 100) || 0;

      return res.json({
        role: "EMPLOYEE",
        employee: { ...employee, id: employee._id.toString() },
        stats: {
          currentMonthAttendance,
          pendingLeaves,
          totalHours: monthlyStats[0]?.totalHours || 0,
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
