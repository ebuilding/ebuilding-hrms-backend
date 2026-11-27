import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import Holiday from "../models/Holiday.js";
import Config from "../models/Config.js";
import LeaveApplication from "../models/LeaveApplication.js";
import CalendarOverride from "../models/CalendarOverride.js";
import { isWeekOffDate } from "./weekOff.js";
import { getCalendarDaySchedule } from "./calendarSchedule.js";
import {
  AttendanceStatus,
  AttendanceStatusLabel,
  DayType,
  ApprovalStatus,
  LeaveStatus,
} from "../constants/enums.js";
import { getAttendanceShiftConfig } from "./shiftConfig.js";

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

  // 1. Fetch Config, Holidays, Overrides, Active Employees, Attendance, Approved Leaves, Shift Config, and MongoDB Aggregates
  const [
    weekOffConfig,
    holidays,
    overrides,
    employees,
    attendances,
    approvedLeaves,
    leaveAggregates,
    attendanceAggregates,
    shiftConfig,
  ] = await Promise.all([
    Config.findOne({ key: "weekOffDays" }).lean(),
    Holiday.find({
      date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
    }).lean(),
    CalendarOverride.find({
      $or: [
        { date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() } },
        { swapDate: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() } },
      ],
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
    LeaveApplication.aggregate([
      {
        $match: {
          status: LeaveStatus.APPROVED,
          startDate: { $lte: endOfMonth.toDate() },
          endDate: { $gte: startOfMonth.toDate() },
        },
      },
      {
        $project: {
          employeeId: 1,
          isHalfDay: 1,
          chargedDays: 1,
          activeWorkingDates: {
            $filter: {
              input: { $ifNull: ["$workingDates", []] },
              as: "d",
              cond: {
                $and: [
                  { $gte: ["$$d", startOfMonth.toDate()] },
                  { $lte: ["$$d", endOfMonth.toDate()] },
                  {
                    $not: {
                      $in: [
                        { $dateToString: { date: "$$d", timezone: TZ, format: "%Y-%m-%d" } },
                        {
                          $map: {
                            input: { $ifNull: ["$revertedDates", []] },
                            as: "rd",
                            in: { $dateToString: { date: "$$rd", timezone: TZ, format: "%Y-%m-%d" } },
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        $project: {
          employeeId: 1,
          isHalfDay: 1,
          leaveDays: {
            $cond: [
              { $gt: [{ $size: "$activeWorkingDates" }, 0] },
              { $multiply: [{ $size: "$activeWorkingDates" }, { $cond: ["$isHalfDay", 0.5, 1.0] }] },
              { $ifNull: ["$chargedDays", 1.0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: "$employeeId",
          approvedLeaveDays: { $sum: "$leaveDays" },
        },
      },
    ]),
    Attendance.aggregate([
      {
        $match: {
          date: { $gte: startOfMonth.toDate(), $lte: endOfMonth.toDate() },
        },
      },
      {
        $group: {
          _id: "$employeeId",
          totalWorkedMinutes: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ["$workingHours", null] }, { $gte: ["$workingHours", 0] }] },
                { $round: [{ $multiply: ["$workingHours", 60] }] },
                0,
              ],
            },
          },
          presentDays: {
            $sum: {
              $cond: [
                { $eq: ["$status", AttendanceStatus.PRESENT] },
                1.0,
                { $cond: [{ $eq: ["$status", AttendanceStatus.HALF_DAY] }, 0.5, 0.0] },
              ],
            },
          },
        },
      },
    ]),
    getAttendanceShiftConfig(),
  ]);

  const leaveAggMap = new Map(
    leaveAggregates.map((l) => [l._id.toString(), l.approvedLeaveDays])
  );
  const attendanceAggMap = new Map(
    attendanceAggregates.map((a) => [a._id.toString(), a])
  );

  const defaultShiftHours = Number(shiftConfig?.shiftHours) || 9;
  const minFullDayMinutes = (Number(shiftConfig?.minHoursForFullDay) || 4) * 60;

  const weekOffSchedule = weekOffConfig?.value || { weeklyDays: ["Sunday"] };

  // Company default working days in this month
  let companyWorkingDays = 0;
  const monthDaysMeta = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dayMoment = startOfMonth.clone().date(d);
    const daySchedule = getCalendarDaySchedule(dayMoment, {
      overrides,
      holidays,
      weekOffConfig: weekOffSchedule,
      timezone: TZ,
    });

    if (daySchedule.isWorkingDay) {
      companyWorkingDays++;
    }

    monthDaysMeta.push({
      dateKey: daySchedule.dateKey,
      dayMoment: daySchedule.dayMoment,
      dayName: daySchedule.dayName,
      isHoliday: daySchedule.isHoliday,
      holidayName: daySchedule.label || null,
      isWeekOff: daySchedule.isWeekOff,
      isCompanyWorkingDay: daySchedule.isWorkingDay,
      isOverride: daySchedule.isOverride,
      overrideType: daySchedule.overrideType,
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

  // Index approved leaves by employeeId -> dateKey (excluding reverted dates)
  const leavesByEmp = new Map();
  for (const leave of approvedLeaves) {
    const empIdStr = leave.employeeId.toString();
    if (!leavesByEmp.has(empIdStr)) {
      leavesByEmp.set(empIdStr, new Map());
    }
    const empLeaves = leavesByEmp.get(empIdStr);
    const revertedDateKeys = new Set(
      (leave.revertedDates || []).map((rd) => moment(rd).tz(TZ).format("YYYY-MM-DD"))
    );

    if (Array.isArray(leave.workingDates) && leave.workingDates.length > 0) {
      for (const d of leave.workingDates) {
        const dKey = moment(d).tz(TZ).format("YYYY-MM-DD");
        if (!revertedDateKeys.has(dKey)) {
          empLeaves.set(dKey, leave);
        }
      }
    } else {
      const cur = moment(leave.startDate).tz(TZ).startOf("day");
      const end = moment(leave.endDate).tz(TZ).startOf("day");
      while (cur.isSameOrBefore(end, "day")) {
        const dKey = cur.format("YYYY-MM-DD");
        if (!revertedDateKeys.has(dKey)) {
          empLeaves.set(dKey, leave);
        }
        cur.add(1, "day");
      }
    }
  }

  const summary = [];
  const detailed = [];

  // Attendance-exempt employees are tracked in headcount but not in punch expectations
  const reportEmployees = employees.filter((emp) => !emp.attendanceExempt);

  // 2. Compute statistics for each employee
  reportEmployees.forEach((emp, index) => {
    const empIdStr = emp._id.toString();
    const empAttendancesMap = attendanceByEmp.get(empIdStr) || new Map();
    const empLeavesMap = leavesByEmp.get(empIdStr) || new Map();
    const empJoinDate = emp.joinDate ? moment(emp.joinDate).tz(TZ).startOf("day") : null;
    const dailyShift =
      emp.customShiftEnabled && emp.shiftHours && emp.shiftHours > 0
        ? emp.shiftHours
        : defaultShiftHours;

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
        const isHalfDayLeave = Boolean(approvedLeave?.isHalfDay);
        const halfShiftMinutes = Math.round((dailyShift / 2) * 60);

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

          if (approvedLeave) {
            // Employee punched in on an approved leave day (e.g. early return before admin reverted)
            statusCode = AttendanceStatus.PRESENT;
            status = AttendanceStatusLabel[AttendanceStatus.PRESENT];
            presentCredit = isHalfDayLeave
              ? dayWorkedMinutes >= minFullDayMinutes ? 0.5 : 0
              : 1.0;
            // On an approved leave day, employee is excused from mandatory shift; worked hours count as surplus
            dayExpectedMinutes = isHalfDayLeave ? halfShiftMinutes : 0;
          } else if (isHalfDayLeave) {
            // Approved half-day leave: the punch only covers the remaining half,
            // so hours are measured against half a shift and leave credits 0.5
            statusCode = AttendanceStatus.HALF_DAY;
            status = AttendanceStatusLabel[AttendanceStatus.HALF_DAY];
            leaveCredit = 0.5;
            presentCredit = dayWorkedMinutes >= minFullDayMinutes ? 0.5 : 0;
            dayExpectedMinutes = halfShiftMinutes;
          } else if (
            att.dayType === DayType.HALF_DAY ||
            (dayWorkedMinutes > 0 && dayWorkedMinutes < minFullDayMinutes)
          ) {
            statusCode = AttendanceStatus.HALF_DAY;
            status = AttendanceStatusLabel[AttendanceStatus.HALF_DAY];
            presentCredit = 0.5;
            dayExpectedMinutes = halfShiftMinutes;
          } else {
            statusCode = AttendanceStatus.PRESENT;
            status = AttendanceStatusLabel[AttendanceStatus.PRESENT];
            presentCredit = 1.0;
            dayExpectedMinutes = Math.round(dailyShift * 60);
          }
        } else {
          // NO punch in/out on a working day!
          if (approvedLeave || att?.status === AttendanceStatus.LEAVE) {
            const isHalf =
              approvedLeave?.isHalfDay || att?.dayType === DayType.HALF_DAY;
            statusCode = AttendanceStatus.LEAVE;
            dayWorkedMinutes = 0;
            if (isHalf) {
              // Half-day leave without a punch: the other half is a missed punch,
              // so it carries half-shift expectation and not-marked credit
              status = "Half Day Leave";
              leaveCredit = 0.5;
              notMarkedCredit = 0.5;
              dayExpectedMinutes = halfShiftMinutes;
            } else {
              status = AttendanceStatusLabel[AttendanceStatus.LEAVE];
              leaveCredit = 1.0;
              dayExpectedMinutes = 0; // Excused leave day
            }
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

    // Approved leave days derived directly from MongoDB aggregation pipeline (excluding reverted dates)
    const approvedLeaveDaysFromApps = leaveAggMap.get(empIdStr) || 0;
    const effectiveLeaveDays = Math.max(approvedLeaveDaysFromApps, leaveDaysCount);

    // Expected hours calculation:
    // Working days excluding approved leaves (identically to Employee Dashboard):
    const activeWorkingDays = Math.max(0, empWorkingDaysCount - effectiveLeaveDays);
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
        leave: effectiveLeaveDays,
        notMarked: notMarkedDaysCount,
        hoursLogged: formatMinutesToHHMM(totalWorkedMinutes),
        expectedHours: formatMinutesToHHMM(expectedMinutes),
        missedHours: formatMinutesToHHMM(missedMinutes),
        hasData: true,
        rawWorkingDays: empWorkingDaysCount,
        rawPresentDays: presentDaysCount,
        rawLeave: effectiveLeaveDays,
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
    companyShiftHours: defaultShiftHours,
    totalEmployees: employees.length,
    summary,
    detailed,
  };
};
