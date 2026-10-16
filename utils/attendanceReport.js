import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import Holiday from "../models/Holiday.js";
import Config from "../models/Config.js";
import Department from "../models/Department.js";
import LeaveApplication from "../models/LeaveApplication.js";
import { isWeekOffDate } from "./weekOff.js";
import {
  AttendanceStatus,
  AttendanceStatusLabel,
  DayType,
  ApprovalStatus,
  LeaveStatus,
} from "../constants/enums.js";

const TZ = "Asia/Kolkata";

/**
 * Format total minutes into HH:MM string (e.g. 211:30, 4:11, 0:00)
 */
export const formatMinutesToHHMM = (totalMinutes, showSign = false) => {
  if (totalMinutes === null || totalMinutes === undefined || isNaN(totalMinutes)) {
    return "0:00";
  }
  const isNegative = totalMinutes < 0;
  const absMinutes = Math.abs(Math.round(totalMinutes));
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const sign = isNegative ? "-" : showSign && totalMinutes > 0 ? "+" : "";
  return `${sign}${hours}:${String(mins).padStart(2, "0")}`;
};

/**
 * Calculate Monthly Attendance Report Data
 * Generates both Quick Summary and Detailed Daily Timesheet for each employee
 *
 * @param {string} monthStr - Format "YYYY-MM" (e.g. "2026-05" or "2026-10")
 */
export const calculateMonthlyReportData = async (monthStr) => {
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    throw new Error("Invalid month format. Expected YYYY-MM");
  }

  const [yearStr, monthNumStr] = monthStr.split("-");
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthNumStr, 10);

  const startOfMonth = moment
    .tz(`${year}-${String(monthNum).padStart(2, "0")}-01`, "YYYY-MM-DD", TZ)
    .startOf("month");
  const endOfMonth = startOfMonth.clone().endOf("month");
  const daysInMonth = startOfMonth.daysInMonth();

  // 1. Fetch Config, Holidays, Active Employees, Attendance, and Approved Leaves
  const [weekOffConfig, holidays, employees, attendances, approvedLeaves] =
    await Promise.all([
      Config.findOne({ key: "weekOffDays" }).lean(),
      Holiday.find({
        date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
      }).lean(),
      Employee.find({
        isDeleted: false,
        $or: [
          { approvalStatus: ApprovalStatus.APPROVED },
          { approvalStatus: { $exists: false } },
          { approvalStatus: null },
        ],
      })
        .populate("department", "name")
        .sort({ firstName: 1, lastName: 1 })
        .lean(),
      Attendance.find({
        date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
      }).lean(),
      LeaveApplication.find({
        status: LeaveStatus.APPROVED,
        startDate: { $lte: endOfMonth.toDate() },
        endDate: { $gte: startOfMonth.toDate() },
      }).lean(),
    ]);

  // Holiday Map (YYYY-MM-DD -> Holiday Name)
  const holidayMap = new Map();
  for (const h of holidays) {
    const dStr = moment(h.date).tz(TZ).format("YYYY-MM-DD");
    holidayMap.set(dStr, h.name || "Holiday");
  }

  const weekOffSchedule = weekOffConfig?.value || { weeklyDays: ["Sunday"] };

  // Company default working days in this month (excluding weekends/holidays)
  let companyWorkingDays = 0;
  const monthDaysMeta = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayMoment = startOfMonth.clone().date(d);
    const dateKey = dayMoment.format("YYYY-MM-DD");
    const dayName = dayMoment.format("dddd");
    const isHoliday = holidayMap.has(dateKey);
    const isWeekOff = isWeekOffDate(dayMoment.toDate(), weekOffSchedule, TZ);
    const isCompanyWorkingDay = !isHoliday && !isWeekOff;

    if (isCompanyWorkingDay) companyWorkingDays++;

    monthDaysMeta.push({
      dateKey,
      dayMoment,
      dayName,
      isHoliday,
      holidayName: holidayMap.get(dateKey) || null,
      isWeekOff,
      isCompanyWorkingDay,
    });
  }

  // Index attendances by employeeId -> dateKey
  const attendanceByEmp = new Map();
  for (const att of attendances) {
    const empIdStr = att.employeeId.toString();
    if (!attendanceByEmp.has(empIdStr)) {
      attendanceByEmp.set(empIdStr, new Map());
    }
    const dateKey = moment(att.date).tz(TZ).format("YYYY-MM-DD");
    attendanceByEmp.get(empIdStr).set(dateKey, att);
  }

  // Index approved leaves by employeeId -> dateKey
  const leavesByEmp = new Map();
  for (const leave of approvedLeaves) {
    const empIdStr = leave.employeeId.toString();
    if (!leavesByEmp.has(empIdStr)) {
      leavesByEmp.set(empIdStr, new Map());
    }
    const empLeaves = leavesByEmp.get(empIdStr);
    if (Array.isArray(leave.workingDates) && leave.workingDates.length > 0) {
      for (const d of leave.workingDates) {
        const dKey = moment(d).tz(TZ).format("YYYY-MM-DD");
        empLeaves.set(dKey, leave);
      }
    } else {
      const cur = moment(leave.startDate).tz(TZ).startOf("day");
      const end = moment(leave.endDate).tz(TZ).startOf("day");
      while (cur.isSameOrBefore(end, "day")) {
        empLeaves.set(cur.format("YYYY-MM-DD"), leave);
        cur.add(1, "day");
      }
    }
  }

  const summary = [];
  const detailed = [];

  // 2. Compute statistics for each employee
  employees.forEach((emp, index) => {
    const empIdStr = emp._id.toString();
    const empAttendancesMap = attendanceByEmp.get(empIdStr) || new Map();
    const empLeavesMap = leavesByEmp.get(empIdStr) || new Map();
    const empJoinDate = emp.joinDate ? moment(emp.joinDate).tz(TZ).startOf("day") : null;
    const dailyShift = emp.shiftHours && emp.shiftHours > 0 ? emp.shiftHours : 9;

    let empWorkingDaysCount = 0;
    let presentDaysCount = 0;
    let leaveDaysCount = 0;
    let notMarkedDaysCount = 0;
    let totalWorkedMinutes = 0;
    const daysData = [];

    monthDaysMeta.forEach((dayMeta) => {
      const { dateKey, dayMoment, dayName, isHoliday, holidayName, isWeekOff, isCompanyWorkingDay } =
        dayMeta;

      const isBeforeJoin = empJoinDate ? dayMoment.isBefore(empJoinDate, "day") : false;
      const isEmpWorkingDay = !isBeforeJoin && isCompanyWorkingDay;
      if (isEmpWorkingDay) {
        empWorkingDaysCount++;
      }

      const att = empAttendancesMap.get(dateKey);
      const approvedLeave = empLeavesMap.get(dateKey);

      let statusCode = AttendanceStatus.NOT_MARKED;
      let status = AttendanceStatusLabel[AttendanceStatus.NOT_MARKED];
      let checkInStr = "—";
      let checkOutStr = "—";
      let dayWorkedMinutes = 0;
      let dayExpectedMinutes = 0;
      let presentCredit = 0;
      let leaveCredit = 0;
      let notMarkedCredit = 0;

      if (isBeforeJoin) {
        statusCode = AttendanceStatus.NOT_JOINED;
        status = AttendanceStatusLabel[AttendanceStatus.NOT_JOINED];
        dayExpectedMinutes = 0;
      } else if (isHoliday) {
        statusCode = AttendanceStatus.HOLIDAY;
        status = holidayName ? `Holiday (${holidayName})` : AttendanceStatusLabel[AttendanceStatus.HOLIDAY];
        dayExpectedMinutes = 0;
        if (att && att.checkIn) {
          checkInStr = moment(att.checkIn).tz(TZ).format("hh:mm A");
          if (att.checkOut) checkOutStr = moment(att.checkOut).tz(TZ).format("hh:mm A");
          dayWorkedMinutes = typeof att.workingHours === "number" && !isNaN(att.workingHours)
            ? Math.round(att.workingHours * 60)
            : att.checkOut
              ? Math.max(0, Math.round((new Date(att.checkOut) - new Date(att.checkIn)) / 60000))
              : 0;
        }
      } else if (isWeekOff) {
        statusCode = AttendanceStatus.WEEK_OFF;
        status = `Week Off (${dayName})`;
        dayExpectedMinutes = 0;
        if (att && att.checkIn) {
          checkInStr = moment(att.checkIn).tz(TZ).format("hh:mm A");
          if (att.checkOut) checkOutStr = moment(att.checkOut).tz(TZ).format("hh:mm A");
          dayWorkedMinutes = typeof att.workingHours === "number" && !isNaN(att.workingHours)
            ? Math.round(att.workingHours * 60)
            : att.checkOut
              ? Math.max(0, Math.round((new Date(att.checkOut) - new Date(att.checkIn)) / 60000))
              : 0;
        }
      } else {
        // Working Day
        if (att && att.checkIn) {
          // Employee punched in/out!
          checkInStr = moment(att.checkIn).tz(TZ).format("hh:mm A");
          if (att.checkOut) checkOutStr = moment(att.checkOut).tz(TZ).format("hh:mm A");

          if (typeof att.workingHours === "number" && !isNaN(att.workingHours)) {
            dayWorkedMinutes = Math.round(att.workingHours * 60);
          } else if (att.checkOut) {
            dayWorkedMinutes = Math.max(
              0,
              Math.round((new Date(att.checkOut) - new Date(att.checkIn)) / 60000)
            );
          }

          if (
            att.dayType === DayType.HALF_DAY ||
            (dayWorkedMinutes > 0 && dayWorkedMinutes < 300)
          ) {
            statusCode = AttendanceStatus.HALF_DAY;
            status = AttendanceStatusLabel[AttendanceStatus.HALF_DAY];
            presentCredit = 0.5;
            dayExpectedMinutes = Math.round((dailyShift / 2) * 60);
          } else {
            statusCode = AttendanceStatus.PRESENT;
            status = AttendanceStatusLabel[AttendanceStatus.PRESENT];
            presentCredit = 1.0;
            dayExpectedMinutes = Math.round(dailyShift * 60);
          }
        } else {
          // NO punch in/out on a working day!
          if (approvedLeave || att?.status === AttendanceStatus.LEAVE) {
            statusCode = AttendanceStatus.LEAVE;
            status = AttendanceStatusLabel[AttendanceStatus.LEAVE];
            const isHalf = approvedLeave?.isHalfDay || att?.dayType === DayType.HALF_DAY;
            leaveCredit = isHalf ? 0.5 : 1.0;
            dayExpectedMinutes = 0; // Excused leave day
            dayWorkedMinutes = 0;
          } else {
            // "If no punch in out on working day it is not marked."
            statusCode = AttendanceStatus.NOT_MARKED;
            status = AttendanceStatusLabel[AttendanceStatus.NOT_MARKED];
            notMarkedCredit = 1.0;
            dayExpectedMinutes = Math.round(dailyShift * 60); // 9:00 expected company hours
            dayWorkedMinutes = 0;
          }
        }
      }

      presentDaysCount += presentCredit;
      leaveDaysCount += leaveCredit;
      notMarkedDaysCount += notMarkedCredit;
      totalWorkedMinutes += dayWorkedMinutes;

      // Gap calculation:
      let gapMinutes = 0;
      let gapStr = "0:00";
      let isShortage = false;

      if (dayExpectedMinutes > 0) {
        gapMinutes = dayWorkedMinutes - dayExpectedMinutes;
        if (gapMinutes < 0) {
          isShortage = true;
          gapStr = `-${formatMinutesToHHMM(Math.abs(gapMinutes))}`;
        } else if (gapMinutes > 0) {
          gapStr = `+${formatMinutesToHHMM(gapMinutes)}`;
        } else {
          gapStr = "0:00";
        }
      } else if (dayWorkedMinutes > 0) {
        // Worked on off/holiday/leave day -> Surplus
        gapMinutes = dayWorkedMinutes;
        gapStr = `+${formatMinutesToHHMM(dayWorkedMinutes)}`;
      } else {
        gapStr = "0:00";
      }

      daysData.push({
        date: dateKey,
        day: dayName,
        statusCode,
        status,
        checkIn: checkInStr,
        checkOut: checkOutStr,
        hoursWorked: formatMinutesToHHMM(dayWorkedMinutes),
        hoursWorkedMinutes: dayWorkedMinutes,
        expectedHours: formatMinutesToHHMM(dayExpectedMinutes),
        expectedMinutes: dayExpectedMinutes,
        gap: gapStr,
        gapMinutes,
        isShortage,
        isWorkingDay: isEmpWorkingDay,
      });
    });

    const hasAttendanceData = empAttendancesMap.size > 0 || totalWorkedMinutes > 0;
    
    // Expected hours calculation:
    // "expected hours is total working day * compnay hours (9). Hours worked is toal punch in out time sum house."
    // Working days excluding approved leaves:
    const activeWorkingDays = Math.max(0, empWorkingDaysCount - leaveDaysCount);
    const expectedMinutes = Math.round(activeWorkingDays * dailyShift * 60);

    let missedMinutes = 0;
    if (totalWorkedMinutes < expectedMinutes) {
      missedMinutes = expectedMinutes - totalWorkedMinutes;
    }

    const employeeFullName = `${emp.firstName} ${emp.lastName}`.trim();
    const deptName = emp.department?.name || "General";

    let summaryItem;
    if (!hasAttendanceData) {
      summaryItem = {
        index: index + 1,
        employeeId: empIdStr,
        employee: employeeFullName,
        department: deptName,
        position: emp.position || "",
        workingDays: "-",
        presentDays: "-",
        leave: "-",
        notMarked: "-",
        hoursLogged: "-",
        expectedHours: "-",
        missedHours: "Not in attendance data",
        hasData: false,
        rawWorkingDays: empWorkingDaysCount,
        rawPresentDays: 0,
        rawLeave: 0,
        rawNotMarked: 0,
        rawHoursLoggedMinutes: 0,
        rawExpectedMinutes: 0,
        rawMissedMinutes: 0,
      };
    } else {
      summaryItem = {
        index: index + 1,
        employeeId: empIdStr,
        employee: employeeFullName,
        department: deptName,
        position: emp.position || "",
        workingDays: empWorkingDaysCount,
        presentDays: presentDaysCount,
        leave: leaveDaysCount,
        notMarked: notMarkedDaysCount,
        hoursLogged: formatMinutesToHHMM(totalWorkedMinutes),
        expectedHours: formatMinutesToHHMM(expectedMinutes),
        missedHours: formatMinutesToHHMM(missedMinutes),
        hasData: true,
        rawWorkingDays: empWorkingDaysCount,
        rawPresentDays: presentDaysCount,
        rawLeave: leaveDaysCount,
        rawNotMarked: notMarkedDaysCount,
        rawHoursLoggedMinutes: totalWorkedMinutes,
        rawExpectedMinutes: expectedMinutes,
        rawMissedMinutes: missedMinutes,
      };
    }

    summary.push(summaryItem);

    detailed.push({
      employeeId: empIdStr,
      employee: employeeFullName,
      department: deptName,
      position: emp.position || "",
      shiftHours: dailyShift,
      hasData: hasAttendanceData,
      summary: summaryItem,
      days: daysData,
    });
  });

  return {
    month: monthStr,
    monthName: startOfMonth.format("MMMM YYYY"),
    companyWorkingDays,
    totalEmployees: employees.length,
    summary,
    detailed,
  };
};
