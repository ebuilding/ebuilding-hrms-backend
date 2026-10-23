import moment from "moment-timezone";
import { inngest } from "../inngest/index.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import Config from "../models/Config.js";
import { getCompOffLabelForDate } from "../utils/compOff.js";
import ExcelJS from "exceljs";
import {
  UserRole,
  AttendanceStatus,
  DayType,
  CompOffType,
  ReportExportType,
} from "../constants/enums.js";
import {
  getAttendanceShiftConfig,
  determineAttendanceDayType,
} from "../utils/shiftConfig.js";

const TZ = "Asia/Kolkata";

const getTodayDate = () => {
  return moment.tz(TZ).startOf("day").toDate();
};

const sendCheckOutEvent = async (attendance) => {
  try {
    await inngest.send({
      name: "employee/check-out",
      data: {
        employeeId: attendance.employeeId,
        attendanceId: attendance._id,
      },
    });
  } catch (error) {
    console.error("Failed to dispatch employee/check-out event:", error);
  }
};

const parseLocalDate = (value) => {
  if (!value) return null;
  return moment.tz(value, "YYYY-MM-DD", TZ).startOf("day").toDate();
};

const parseLocalTime = (time, baseDate) => {
  if (!time || !baseDate) return null;
  if (time.includes("T")) {
    return moment.tz(time, TZ).toDate();
  }
  const dateStr = moment(baseDate).tz(TZ).format("YYYY-MM-DD");
  return moment.tz(`${dateStr} ${time}`, "YYYY-MM-DD HH:mm", TZ).toDate();
};

// Clock in/out for employee
// POST /api/attendance
export const clockInOut = async (req, res) => {
  try {
    const session = req.session;
    let employee;

    if (req.body?.employeeId && session.role === UserRole.ADMIN) {
      employee = await Employee.findById(req.body.employeeId);
    } else {
      employee = await Employee.findOne({ userId: session.userId });
    }

    if (!employee) return res.status(404).json({ error: "Employee not found" });
    if (employee.isDeleted)
      return res.status(403).json({
        error: "Your account is deactivated. You cannot clock in/out.",
      });

    const now = moment.tz(TZ).toDate();

    // Check location if config is set
    const locationConfig = await Config.findOne({ key: "companyLocation" });
    if (
      locationConfig &&
      locationConfig.value &&
      locationConfig.value.enabled
    ) {
      const { lat, lng, radius } = locationConfig.value;
      const userLat = req.body?.latitude;
      const userLng = req.body?.longitude;

      if (
        userLat === undefined ||
        userLat === null ||
        userLng === undefined ||
        userLng === null ||
        isNaN(Number(userLat)) ||
        isNaN(Number(userLng))
      ) {
        return res
          .status(400)
          .json({ error: "Location is required to punch in/out. Please enable GPS/location on your device." });
      }

      // Haversine formula
      const R = 6371e3; // metres
      const φ1 = (lat * Math.PI) / 180; // φ, λ in radians
      const φ2 = (userLat * Math.PI) / 180;
      const Δφ = ((userLat - lat) * Math.PI) / 180;
      const Δλ = ((userLng - lng) * Math.PI) / 180;

      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distance = R * c; // in metres

      if (distance > radius) {
        return res
          .status(403)
          .json({
            error: `You must be within ${radius}m of the company to punch in/out. You are ${Math.round(distance)}m away.`,
          });
      }
    }

    // 1. Search for any open attendance record (checked in but not checked out) within the last 16 hours
    // to support clocking out of shifts that cross midnight
    const openCutoff = moment(now).subtract(16, "hours").toDate();
    const openRecord = await Attendance.findOne({
      employeeId: employee._id,
      checkIn: { $ne: null, $gte: openCutoff },
      checkOut: null,
    });

    if (openRecord) {
      openRecord.checkOut = now;
      const duration = Math.max(
        0,
        (openRecord.checkOut - openRecord.checkIn) / (1000 * 60 * 60),
      );
      openRecord.workingHours = parseFloat(duration.toFixed(2));
      const shiftConfig = await getAttendanceShiftConfig();
      const { dayType } = determineAttendanceDayType(
        openRecord.workingHours,
        shiftConfig,
      );
      openRecord.dayType = dayType;
      await openRecord.save();
      // Comp-off is not credited automatically; employee must submit a Comp-Off Request for admin approval
      return res.json({ success: true, type: "CHECK_OUT", data: openRecord });
    }

    // 2. If no open record exists, look for today's record to register a check-in
    const todayStart = moment.tz(TZ).startOf("day").toDate();
    const todayEnd = moment.tz(TZ).endOf("day").toDate();

    const existing = await Attendance.findOne({
      employeeId: employee._id,
      date: { $gte: todayStart, $lte: todayEnd },
    });

    if (!existing) {
      const compoffLabel = await getCompOffLabelForDate(todayStart);
      const attendance = await Attendance.create({
        employeeId: employee._id,
        date: todayStart,
        checkIn: now,
        status: AttendanceStatus.PRESENT,
        ...(compoffLabel ? { compoffFor: compoffLabel } : {}),
      });

      await sendCheckOutEvent(attendance);

      return res.json({ success: true, type: "CHECK_IN", data: attendance });
    } else if (
      (existing.status === AttendanceStatus.HOLIDAY || existing.status === AttendanceStatus.WEEK_OFF) &&
      !existing.checkIn
    ) {
      const originalStatus = existing.status;
      existing.checkIn = now;
      existing.status = AttendanceStatus.PRESENT;
      existing.compoffFor =
        originalStatus === AttendanceStatus.HOLIDAY
          ? CompOffType.HOLIDAY
          : CompOffType.WEEK_OFF;
      await existing.save();

      await sendCheckOutEvent(existing);
      return res.json({ success: true, type: "CHECK_IN", data: existing });
    } else if (!existing.checkIn) {
      existing.checkIn = now;
      existing.status = AttendanceStatus.PRESENT;
      await existing.save();

      await sendCheckOutEvent(existing);
      return res.json({ success: true, type: "CHECK_IN", data: existing });
    } else {
      return res.status(400).json({ error: "Already checked out for today" });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get attendance history
// POST /api/attendance/history
export const getAttendance = async (req, res) => {
  try {
    const session = req.session;
    const { month, employeeId } = req.body; // format: "YYYY-MM"

    let employee;
    if (employeeId && session.role === UserRole.ADMIN) {
      employee = await Employee.findById(employeeId);
    } else {
      employee = await Employee.findOne({ userId: session.userId });
      if (!employee && session.role === UserRole.ADMIN) {
        employee = await Employee.findOne({ isDeleted: { $ne: true } });
      }
    }

    if (!employee) return res.status(404).json({ error: "No employee record found" });

    const [year, monthNum] = month.split("-");
    const startOfMonth = moment
      .tz(`${year}-${monthNum}-01`, "YYYY-MM-DD", TZ)
      .startOf("month")
      .toDate();
    const endOfMonth = moment
      .tz(`${year}-${monthNum}-01`, "YYYY-MM-DD", TZ)
      .endOf("month")
      .toDate();

    const todayStart = moment.tz(TZ).startOf("day").toDate();
    const todayEnd = moment.tz(TZ).endOf("day").toDate();

    const [shiftConfig, results, todayRecord] = await Promise.all([
      getAttendanceShiftConfig(),
      Attendance.aggregate([
        {
          $match: {
            employeeId: employee._id,
            date: { $gte: startOfMonth, $lte: endOfMonth },
          },
        },
        {
          $facet: {
            history: [{ $sort: { date: 1 } }],
            summary: [
              {
                $group: {
                  _id: null,
                  present: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $eq: ["$status", AttendanceStatus.PRESENT] },
                            { $ne: ["$dayType", DayType.HALF_DAY] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  leave: {
                    $sum: { $cond: [{ $eq: ["$status", "LEAVE"] }, 1, 0] },
                  },
                  holiday: {
                    $sum: { $cond: [{ $eq: ["$status", "HOLIDAY"] }, 1, 0] },
                  },
                  weekOff: {
                    $sum: { $cond: [{ $eq: ["$status", "WEEK_OFF"] }, 1, 0] },
                  },
                  halfDay: {
                    $sum: {
                      $cond: [
                        {
                          $or: [
                            { $eq: ["$dayType", DayType.HALF_DAY] },
                            { $eq: ["$status", AttendanceStatus.HALF_DAY] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  notMarked: {
                    $sum: { $cond: [{ $eq: ["$status", "NOT_MARKED"] }, 1, 0] },
                  },
                  totalHours: { $sum: "$workingHours" },
                },
              },
            ],
          },
        },
      ]),
      Attendance.findOne({
        employeeId: employee._id,
        date: { $gte: todayStart, $lte: todayEnd },
      }).lean(),
    ]);

    const history = results[0].history;
    const stats = results[0].summary[0] || {
      present: 0,
      leave: 0,
      holiday: 0,
      weekOff: 0,
      halfDay: 0,
      notMarked: 0,
      totalHours: 0,
    };

    // Ensure totalHours is rounded
    stats.totalHours = parseFloat((stats.totalHours || 0).toFixed(2));

    res.json({
      success: true,
      data: history,
      todayRecord,
      stats,
      shiftConfig,
      employee: { isDeleted: employee.isDeleted },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: Clock in/out for any employee
// POST /api/attendance/admin/:employeeId
export const adminClockInOut = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { date, checkIn, checkOut, status, dayType, compoffFor } = req.body;

    const baseDate = parseLocalDate(date);
    if (!baseDate) return res.status(400).json({ error: "Invalid date" });

    const todayStart = moment(baseDate).tz(TZ).startOf("day").toDate();
    const todayEnd = moment(baseDate).tz(TZ).endOf("day").toDate();

    let attendance = await Attendance.findOne({
      employeeId,
      date: { $gte: todayStart, $lte: todayEnd },
    });

    const checkInTime = parseLocalTime(checkIn, baseDate);
    const checkOutTime = parseLocalTime(checkOut, baseDate);

    if (!attendance) {
      attendance = new Attendance({
        employeeId,
        date: todayStart,
      });
    }

    attendance.checkIn = checkInTime;
    attendance.checkOut = checkOutTime;
    attendance.status = status || AttendanceStatus.PRESENT;
    attendance.compoffFor = compoffFor || "";
    attendance.updatedBy = req.session.email;
    attendance.adminUpdatedAt = new Date();
    if (checkInTime && checkOutTime) {
      if (checkOutTime < checkInTime) {
        checkOutTime.setDate(checkOutTime.getDate() + 1);
        attendance.checkOut = checkOutTime;
      }
      // Note: This logic assumes shifts are less than 24 hours.
      // If a shift works more than 24h, this single-day rollover will not accurately capture the total duration.
      const duration = Math.max(
        0,
        (checkOutTime - checkInTime) / (1000 * 60 * 60),
      );
      attendance.workingHours = parseFloat(duration.toFixed(2));
    }

    if (dayType) {
      attendance.dayType = dayType;
    } else if (attendance.workingHours !== null && attendance.workingHours !== undefined) {
      const shiftConfig = await getAttendanceShiftConfig();
      attendance.dayType = determineAttendanceDayType(
        attendance.workingHours,
        shiftConfig,
      ).dayType;
    } else {
      attendance.dayType = DayType.FULL_DAY;
    }

    await attendance.save();
    // Comp-off is not credited automatically; employee must submit a Comp-Off Request for admin approval
    res.json({ success: true, data: attendance });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Admin: Get today's attendance for a specific employee
// GET /api/attendance/admin/:employeeId/today
export const getAdminTodayAttendance = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { date } = req.query;

    const baseDate = date
      ? parseLocalDate(date)
      : moment.tz(TZ).startOf("day").toDate();
    const todayStart = moment(baseDate).tz(TZ).startOf("day").toDate();
    const todayEnd = moment(baseDate).tz(TZ).endOf("day").toDate();

    const attendance = await Attendance.findOne({
      employeeId,
      date: { $gte: todayStart, $lte: todayEnd },
    });

    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get attendance stats/trend for employee dashboard
// GET /api/attendance/stats/trend
export const getAttendanceStats = async (req, res) => {
  try {
    const session = req.session;
    const { range = "week" } = req.query;
    const employee = await Employee.findOne({ userId: session.userId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const now = moment.tz(TZ);
    let startDate;

    if (range === "month") {
      startDate = now.clone().startOf("month");
    } else {
      startDate = now.clone().subtract(6, "days").startOf("day");
    }

    const attendance = await Attendance.find({
      employeeId: employee._id,
      date: { $gte: startDate.toDate(), $lte: now.toDate() },
    })
      .sort({ date: 1 })
      .lean();

    const trend = [];
    const days = range === "month" ? now.date() : 7;

    for (let i = days - 1; i >= 0; i--) {
      const d = now.clone().subtract(i, "days").startOf("day");
      const record = attendance.find((a) =>
        moment(a.date).tz(TZ).isSame(d, "day"),
      );

      let hours = record ? record.workingHours || 0 : 0;
      let isOngoing = false;
      if (record && record.checkIn && !record.checkOut) {
        hours = Math.max(
          0,
          (Date.now() - new Date(record.checkIn).getTime()) / (1000 * 60 * 60),
        );
        isOngoing = true;
      }

      trend.push({
        date: d.format("MMM DD"),
        hours: parseFloat(hours.toFixed(2)),
        status: record ? record.status : "LEAVE",
        isOngoing,
      });
    }

    res.json(trend);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get today attendance for button state
// GET /api/attendance/today
export const getTodayAttendance = async (req, res) => {
  try {
    const session = req.session;
    const employee = await Employee.findOne({ userId: session.userId });
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const todayStart = moment.tz(TZ).startOf("day").toDate();
    const todayEnd = moment.tz(TZ).endOf("day").toDate();

    const todayRecord = await Attendance.findOne({
      employeeId: employee._id,
      date: { $gte: todayStart, $lte: todayEnd },
    });

    res.json(todayRecord);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

import { calculateMonthlyReportData } from "../utils/attendanceReport.js";

// Admin: Get monthly report JSON data
// GET /api/attendance/admin/report?month=YYYY-MM
export const getMonthlyReportData = async (req, res) => {
  try {
    const month = req.query.month || moment().tz(TZ).format("YYYY-MM");
    const reportData = await calculateMonthlyReportData(month);
    res.json({ success: true, ...reportData });
  } catch (error) {
    console.error("Report Data Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Admin: Export monthly attendance to Excel (Two-tab report: Quick Summary & Detailed Timesheet)
// POST /api/attendance/admin/export
export const exportMonthlyAttendance = async (req, res) => {
  try {
    const { month, exportType = ReportExportType.SUMMARY, employeeId } = req.body; // format: "YYYY-MM"
    if (!month) {
      return res.status(400).json({ error: "Month is required" });
    }

    const reportData = await calculateMonthlyReportData(month);
    const { summary, detailed, monthName } = reportData;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "E Building HRMS";
    workbook.lastModifiedBy = "Admin";
    workbook.created = new Date();
    workbook.modified = new Date();

    const includeSummary =
      exportType === ReportExportType.SUMMARY ||
      exportType === ReportExportType.ALL;
    const includeDetailed =
      exportType === ReportExportType.DETAILED ||
      exportType === ReportExportType.ALL;

    // Filter detailed employees if employeeId provided
    const targetDetailed = employeeId
      ? detailed.filter((e) => e.employeeId === employeeId)
      : detailed;

    // ==========================================
    // TAB 1: QUICK SUMMARY
    // ==========================================
    if (includeSummary) {
      const summarySheet = workbook.addWorksheet("Quick Summary", {
        views: [{ showGridLines: true }],
      });

      summarySheet.columns = [
        { key: "index", width: 8 },
        { key: "employee", width: 28 },
        { key: "workingDays", width: 16 },
        { key: "presentDays", width: 16 },
        { key: "leave", width: 14 },
        { key: "notMarked", width: 14 },
        { key: "hoursLogged", width: 18 },
        { key: "expectedHours", width: 18 },
        { key: "missedHours", width: 24 },
      ];

      // Sheet Title
      summarySheet.mergeCells("A1:I1");
      const titleCell = summarySheet.getCell("A1");
      titleCell.value = `Attendance Quick Summary - ${monthName}`;
      titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
      titleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" }, // Dark Slate (Tailwind slate-900)
      };
      titleCell.alignment = { vertical: "middle", horizontal: "center" };
      summarySheet.getRow(1).height = 34;

      // Header Row
      const summaryHeaderRow = summarySheet.addRow([
        "#",
        "Employee",
        "Working Days",
        "Present Days",
        "Leave",
        "Not Marked",
        "Hours Logged",
        "Expected Hours",
        "Missed Hours",
      ]);
      summaryHeaderRow.height = 26;

      summaryHeaderRow.eachCell((cell) => {
        cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF334155" }, // Slate-700
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          top: { style: "thin", color: { argb: "FF94A3B8" } },
          bottom: { style: "medium", color: { argb: "FF475569" } },
          left: { style: "thin", color: { argb: "FF94A3B8" } },
          right: { style: "thin", color: { argb: "FF94A3B8" } },
        };
      });

      // Data Rows
      summary.forEach((item, idx) => {
        const row = summarySheet.addRow([
          item.index,
          item.employee,
          item.workingDays,
          item.presentDays,
          item.leave,
          item.notMarked,
          item.hoursLogged,
          item.expectedHours,
          item.missedHours,
        ]);
        row.height = 22;

        const isEven = idx % 2 === 0;
        const bgArgb = isEven ? "FFFFFFFF" : "FFF8FAFC";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Arial", size: 10, color: { argb: "FF1E293B" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: bgArgb },
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FFE2E8F0" } },
            bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
            left: { style: "thin", color: { argb: "FFE2E8F0" } },
            right: { style: "thin", color: { argb: "FFE2E8F0" } },
          };

          // Alignments
          if (colNumber === 1) {
            cell.alignment = { vertical: "middle", horizontal: "center" };
          } else if (colNumber === 2) {
            cell.alignment = { vertical: "middle", horizontal: "left" };
            cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FF0F172A" } };
          } else if (colNumber >= 3 && colNumber <= 5) {
            cell.alignment = { vertical: "middle", horizontal: "center" };
          } else if (colNumber === 6) {
            // Not Marked
            cell.alignment = { vertical: "middle", horizontal: "center" };
            if (Number(item.notMarked) > 0) {
              cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFEA580C" } }; // Orange
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFF7ED" },
              };
            }
          } else if (colNumber === 7 || colNumber === 8) {
            cell.alignment = { vertical: "middle", horizontal: "right" };
          } else if (colNumber === 9) {
            cell.alignment = { vertical: "middle", horizontal: "right" };
            if (item.missedHours !== "0:00" && item.missedHours !== "Not in attendance data") {
              cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFDC2626" } }; // Red
              cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFFFF1F2" }, // Soft rose
              };
            } else if (item.missedHours === "Not in attendance data") {
              cell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF64748B" } };
              cell.alignment = { vertical: "middle", horizontal: "center" };
            } else {
              cell.font = { name: "Arial", size: 10, color: { argb: "FF059669" } }; // Green
            }
          }
        });
      });
    }

    // ==========================================
    // TAB 2: DETAILED EMPLOYEE REPORT
    // ==========================================
    if (includeDetailed) {
      const detailSheet = workbook.addWorksheet("Detailed Employee Report", {
        views: [{ showGridLines: true }],
      });

      detailSheet.columns = [
        { key: "date", width: 14 },
        { key: "day", width: 14 },
        { key: "status", width: 18 },
        { key: "checkIn", width: 14 },
        { key: "checkOut", width: 14 },
        { key: "hoursWorked", width: 16 },
        { key: "expectedHours", width: 16 },
        { key: "gap", width: 18 },
      ];

      // Sheet Main Title
      detailSheet.mergeCells("A1:H1");
      const detailTitleCell = detailSheet.getCell("A1");
      detailTitleCell.value = `Detailed Employee Attendance Report - ${monthName}`;
      detailTitleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
      detailTitleCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0F172A" },
      };
      detailTitleCell.alignment = { vertical: "middle", horizontal: "center" };
      detailSheet.getRow(1).height = 34;

      detailSheet.addRow([]); // Blank spacer

      targetDetailed.forEach((emp) => {
        // 1. Employee Name Header Banner
        const empHeaderRow = detailSheet.addRow([
          `Employee: ${emp.employee}  (${emp.department} • Shift: ${emp.shiftHours} hrs)`,
        ]);
        empHeaderRow.height = 24;
        const startRowIdx = empHeaderRow.number;
        detailSheet.mergeCells(`A${startRowIdx}:H${startRowIdx}`);
        const empCell = detailSheet.getCell(`A${startRowIdx}`);
        empCell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FF1E293B" } };
        empCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE2E8F0" }, // Slate-200
        };
        empCell.alignment = { vertical: "middle", horizontal: "left" };
        empCell.border = {
          top: { style: "medium", color: { argb: "FF64748B" } },
          bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
          left: { style: "medium", color: { argb: "FF64748B" } },
          right: { style: "medium", color: { argb: "FF64748B" } },
        };

        // 2. One-line Quick Summary row for this employee
        const s = emp.summary;
        const summaryText = s.hasData
          ? `Working Days: ${s.workingDays}  |  Present Days: ${s.presentDays}  |  Leave: ${s.leave}  |  Not Marked: ${s.notMarked}  |  Hours Logged: ${s.hoursLogged}  |  Expected Hours: ${s.expectedHours}  |  Missed Hours: ${s.missedHours}`
          : "No attendance data available for this employee this month";

        const empSummaryRow = detailSheet.addRow([summaryText]);
        empSummaryRow.height = 20;
        const summaryRowIdx = empSummaryRow.number;
        detailSheet.mergeCells(`A${summaryRowIdx}:H${summaryRowIdx}`);
        const summaryCell = detailSheet.getCell(`A${summaryRowIdx}`);
        summaryCell.font = {
          name: "Arial",
          size: 9.5,
          bold: true,
          color: s.missedHours && s.missedHours !== "0:00" && s.hasData ? { argb: "FFB91C1C" } : { argb: "FF475569" },
        };
        summaryCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" },
        };
        summaryCell.alignment = { vertical: "middle", horizontal: "left" };
        summaryCell.border = {
          bottom: { style: "thin", color: { argb: "FF94A3B8" } },
          left: { style: "medium", color: { argb: "FF64748B" } },
          right: { style: "medium", color: { argb: "FF64748B" } },
        };

        // 3. Table Headers for daily timesheet
        const tableHeaderRow = detailSheet.addRow([
          "Date",
          "Day",
          "Status",
          "Check In",
          "Check Out",
          "Hours Worked",
          "Expected Hours",
          "Hours Gap",
        ]);
        tableHeaderRow.height = 20;
        tableHeaderRow.eachCell((cell) => {
          cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF475569" }, // Slate-600
          };
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin", color: { argb: "FF94A3B8" } },
            bottom: { style: "thin", color: { argb: "FF94A3B8" } },
            left: { style: "thin", color: { argb: "FF94A3B8" } },
            right: { style: "thin", color: { argb: "FF94A3B8" } },
          };
        });

        // 4. Daily Data Rows
        emp.days.forEach((day, dIdx) => {
          const dRow = detailSheet.addRow([
            day.date,
            day.day,
            day.status,
            day.checkIn,
            day.checkOut,
            day.hoursWorked,
            day.expectedHours,
            day.gap,
          ]);
          dRow.height = 18;

          const isRowEven = dIdx % 2 === 0;
          const rowBg = isRowEven ? "FFFFFFFF" : "FFF8FAFC";

          dRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
            cell.font = { name: "Arial", size: 9, color: { argb: "FF334155" } };
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: rowBg },
            };
            cell.border = {
              top: { style: "thin", color: { argb: "FFE2E8F0" } },
              bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
              left: { style: "thin", color: { argb: "FFE2E8F0" } },
              right: { style: "thin", color: { argb: "FFE2E8F0" } },
            };

            if (colIdx <= 2) {
              cell.alignment = { vertical: "middle", horizontal: "center" };
            } else if (colIdx === 3) {
              cell.alignment = { vertical: "middle", horizontal: "left" };
              const sVal = String(day.status || "");
              if (sVal === "Present") {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF059669" } };
              } else if (sVal.startsWith("Holiday")) {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF2563EB" } }; // Blue
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
              } else if (sVal.startsWith("Week Off")) {
                cell.font = { name: "Arial", size: 9, color: { argb: "FF64748B" } }; // Slate
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
              } else if (sVal === "Not Marked") {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFEA580C" } }; // Orange
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7ED" } };
              } else if (sVal === "Leave" || sVal === "Absent") {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFE11D48" } };
              } else if (sVal === "Half Day") {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFD97706" } };
              }
            } else if (colIdx === 4 || colIdx === 5) {
              cell.alignment = { vertical: "middle", horizontal: "center" };
            } else if (colIdx === 6 || colIdx === 7) {
              cell.alignment = { vertical: "middle", horizontal: "right" };
            } else if (colIdx === 8) {
              cell.alignment = { vertical: "middle", horizontal: "right" };
              if (day.isShortage) {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFDC2626" } }; // Red for shortage
                cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF1F2" } };
              } else if (day.gap.startsWith("+")) {
                cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF059669" } }; // Green for surplus
              }
            }
          });
        });

        // 5. Spacer between employees
        const spacerRow = detailSheet.addRow([]);
        spacerRow.height = 14;
      });
    }

    // Write buffer and send
    const excelBuffer = await workbook.xlsx.writeBuffer();

    let filePrefix = "Attendance_Report";
    if (exportType === ReportExportType.SUMMARY) filePrefix = "Attendance_Summary";
    else if (exportType === ReportExportType.DETAILED) filePrefix = "Attendance_Detailed";

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${filePrefix}_${month}.xlsx`,
    );
    res.send(excelBuffer);
  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).json({ error: error.message });
  }
};

