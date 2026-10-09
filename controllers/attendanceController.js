import moment from "moment-timezone";
import { inngest } from "../inngest/index.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import Config from "../models/Config.js";
import {
  creditCompOffForAttendance,
  getCompOffLabelForDate,
} from "../utils/compOff.js";
import ExcelJS from "exceljs";

const TZ = "Asia/Kolkata";

const getTodayDate = () => {
  return moment.tz(TZ).startOf("day").toDate();
};

const sendCheckOutEvent = async (attendance) => {
  await inngest.send({
    name: "employee/check-out",
    data: {
      employeeId: attendance.employeeId,
      attendanceId: attendance._id,
    },
  });
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

    if (
      req.body?.employeeId &&
      (session.role === "ADMIN" || session.role === "SECURITY")
    ) {
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

      if (!userLat || !userLng) {
        return res
          .status(400)
          .json({ error: "Location is required to punch in/out" });
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
      const duration =
        (openRecord.checkOut - openRecord.checkIn) / (1000 * 60 * 60);
      openRecord.workingHours = parseFloat(duration.toFixed(2));
      openRecord.dayType =
        openRecord.workingHours >= 8 ? "Full Day" : "Half Day";
      await openRecord.save();
      await creditCompOffForAttendance(openRecord);
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
        status: "PRESENT",
        ...(compoffLabel ? { compoffFor: compoffLabel } : {}),
      });

      await inngest.send({
        name: "employee/check-out",
        data: {
          employeeId: employee._id,
          attendanceId: attendance._id,
        },
      });

      return res.json({ success: true, type: "CHECK_IN", data: attendance });
    } else if (
      (existing.status === "HOLIDAY" || existing.status === "WEEK_OFF") &&
      !existing.checkIn
    ) {
      const originalStatus = existing.status;
      existing.checkIn = now;
      existing.status = "PRESENT";
      existing.compoffFor =
        originalStatus === "HOLIDAY" ? "Holiday" : "Week Off";
      await existing.save();

      await inngest.send({
        name: "employee/check-out",
        data: {
          employeeId: employee._id,
          attendanceId: existing._id,
        },
      });
      return res.json({ success: true, type: "CHECK_IN", data: existing });
    } else if (!existing.checkIn) {
      existing.checkIn = now;
      existing.status = "PRESENT";
      await existing.save();

      await inngest.send({
        name: "employee/check-out",
        data: {
          employeeId: employee._id,
          attendanceId: existing._id,
        },
      });
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
    if (employeeId && session.role === "ADMIN") {
      employee = await Employee.findById(employeeId);
    } else {
      employee = await Employee.findOne({ userId: session.userId });
    }

    if (!employee) return res.status(404).json({ error: "Employee not found" });

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

    const [results, todayRecord] = await Promise.all([
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
                            { $eq: ["$status", "PRESENT"] },
                            { $ne: ["$dayType", "Half Day"] },
                            {
                              $or: [
                                { $eq: ["$workingHours", null] },
                                { $gte: ["$workingHours", 8] },
                              ],
                            },
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
                            { $eq: ["$dayType", "Half Day"] },
                            {
                              $and: [
                                { $eq: ["$status", "PRESENT"] },
                                { $ne: ["$workingHours", null] },
                                { $lt: ["$workingHours", 8] },
                              ],
                            },
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
    stats.totalHours = parseFloat(stats.totalHours.toFixed(2));

    res.json({
      success: true,
      data: history,
      todayRecord,
      stats,
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
    attendance.status = status || "PRESENT";
    attendance.dayType = dayType || "Full Day";
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
      const duration = (checkOutTime - checkInTime) / (1000 * 60 * 60);
      attendance.workingHours = parseFloat(duration.toFixed(2));
    }

    await attendance.save();
    if (checkInTime && checkOutTime) {
      await creditCompOffForAttendance(attendance);
    }
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
        hours =
          (Date.now() - new Date(record.checkIn).getTime()) / (1000 * 60 * 60);
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

// Admin: Export monthly attendance to Excel
// POST /api/attendance/admin/export
export const exportMonthlyAttendance = async (req, res) => {
  try {
    const { month } = req.body; // format: "YYYY-MM"
    if (!month) {
      return res.status(400).json({ error: "Month is required" });
    }

    const [year, monthNum] = month.split("-");
    const startOfMonth = moment
      .tz(`${year}-${monthNum}-01`, "YYYY-MM-DD", TZ)
      .startOf("month")
      .toDate();
    const endOfMonth = moment
      .tz(`${year}-${monthNum}-01`, "YYYY-MM-DD", TZ)
      .endOf("month")
      .toDate();

    // Fetch all active employees
    const employees = await Employee.find({ isDeleted: false })
      .populate("department")
      .lean();

    // Fetch attendance for the month
    const attendances = await Attendance.find({
      date: { $gte: startOfMonth, $lte: endOfMonth },
    }).lean();

    // Group attendances by employeeId
    const attendanceByEmployee = attendances.reduce((acc, curr) => {
      const empId = curr.employeeId.toString();
      if (!acc[empId]) {
        acc[empId] = [];
      }
      acc[empId].push(curr);
      return acc;
    }, {});

    // Fetch config for report calculation
    const calcConfig = await Config.findOne({ key: "enableReportCalculation" });
    const enableReportCalculation = calcConfig
      ? calcConfig.value === true
      : false;

    // Prepare data for Excel
    const excelData = employees.map((emp) => {
      const empAttendances = attendanceByEmployee[emp._id.toString()] || [];

      const totalDaysPresent = empAttendances.filter(
        (a) => a.status === "PRESENT" || a.status === "HALF_DAY",
      ).length;
      const totalWorkingHours = empAttendances.reduce(
        (sum, a) => sum + (a.workingHours || 0),
        0,
      );

      const row = {
        "Employee Name": `${emp.firstName} ${emp.lastName}`,
        Department: emp.department ? emp.department.name : "N/A",
        "Shift Hours": emp.shiftHours || "N/A",
        "Total Days Present": totalDaysPresent,
        "Total Working Hours": parseFloat(totalWorkingHours.toFixed(2)),
      };

      if (enableReportCalculation) {
        row["Calculated Days"] =
          emp.shiftHours && emp.shiftHours > 0
            ? parseFloat((totalWorkingHours / emp.shiftHours).toFixed(2))
            : "N/A";
      }

      return row;
    });

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Monthly Attendance");

    // Define columns
    const columns = [
      { header: "Employee Name", key: "Employee Name", width: 25 },
      { header: "Department", key: "Department", width: 20 },
      { header: "Shift Hours", key: "Shift Hours", width: 15 },
      { header: "Total Days Present", key: "Total Days Present", width: 20 },
      { header: "Total Working Hours", key: "Total Working Hours", width: 25 },
    ];
    if (enableReportCalculation) {
      columns.push({
        header: "Calculated Days",
        key: "Calculated Days",
        width: 20,
      });
    }
    worksheet.columns = columns;

    // Add data
    excelData.forEach((row) => {
      worksheet.addRow(row);
    });

    // Style the header row (Bold text, Yellow BG, Center aligned, Borders)
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" }, // Yellow
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // Style the rest of the cells (Center aligned, Borders)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        // Skip header row
        row.eachCell((cell) => {
          cell.alignment = { vertical: "middle", horizontal: "center" };
          cell.border = {
            top: { style: "thin" },
            left: { style: "thin" },
            bottom: { style: "thin" },
            right: { style: "thin" },
          };
        });
      }
    });

    // Generate buffer
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Set headers and send response
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=Attendance_${month}.xlsx`,
    );
    res.send(excelBuffer);
  } catch (error) {
    console.error("Export Error:", error);
    res.status(500).json({ error: error.message });
  }
};
