import moment from "moment-timezone";
import { Inngest } from "inngest";
import connectDB from "../config/db.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import Holiday from "../models/Holiday.js";
import CalendarOverride from "../models/CalendarOverride.js";
import Config from "../models/Config.js";
import sendEmail from "../config/nodemailer.js";
import { AttendanceStatus } from "../constants/enums.js";
import { getCalendarDaySchedule } from "../utils/calendarSchedule.js";
import {
  getAttendanceShiftConfig,
  determineAttendanceDayType,
  getShiftEndMoment,
} from "../utils/shiftConfig.js";

const TZ = "Asia/Kolkata";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "fullstack-ems" });

// Premium Email Template Helper
const getEmailTemplate = (content, title = "E Building HRMS Notification") => `
<div style="
  background:#f4f7fb;
  padding:32px 16px;
  font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
">

  <div style="
    max-width:640px;
    margin:auto;
    background:#ffffff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    overflow:hidden;
  ">

    <!-- Header -->
    <div style="
      padding:24px 32px;
      border-bottom:1px solid #eef2f7;
      background:#ffffff;
    ">

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="left">
            <div style="
              font-size:20px;
              font-weight:700;
              color:#111827;
              letter-spacing:-0.02em;
            ">
              E Building HRMS
            </div>

            <div style="
              margin-top:4px;
              font-size:13px;
              color:#6b7280;
            ">
              Workforce Management System
            </div>
          </td>

          <td align="right">
            <div style="
              background:#fdf2f8;
              color:#811c50;
              font-size:12px;
              font-weight:600;
              padding:6px 12px;
              border-radius:999px;
              display:inline-block;
            ">
              ${title}
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="
      padding:36px 32px;
      color:#374151;
      font-size:15px;
      line-height:1.8;
    ">

      ${content}

    </div>

    <!-- Footer -->
    <div style="
      padding:20px 32px;
      border-top:1px solid #eef2f7;
      background:#fcfcfd;
    ">

      <div style="
        font-size:13px;
        color:#94a3b8;
        line-height:1.7;
      ">
        This is an automated email from E Building HRMS.<br>
        Please do not reply directly to this message.
      </div>

      <div style="
        margin-top:12px;
        font-size:12px;
        color:#c0c7d2;
      ">
        © ${new Date().getFullYear()} E Building HRMS. All rights reserved.
      </div>

    </div>
  </div>
</div>
`;

// Auto Check-out for employees
const autoCheckOut = inngest.createFunction(
  { id: "auto-check-out", triggers: [{ event: "employee/check-out" }] },
  async ({ event, step }) => {
    await connectDB();
    const { employeeId, attendanceId } = event.data || {};

    if (!attendanceId) {
      console.warn("[auto-check-out] Missing attendanceId in event data");
      return;
    }

    // Wait for 13 hours
    await step.sleepUntil(
      "wait-for-the-13-hours",
      moment().add(13, "hours").toDate(),
    );

    await connectDB();

    // get Attendance data
    let attendance = await Attendance.findById(attendanceId);

    // If attendance record no longer exists or employee already checked out, stop
    if (!attendance || attendance.checkOut) {
      return;
    }

    // Extract employee ID cleanly (whether string, ObjectId, or object)
    const empId =
      (typeof employeeId === "object" ? employeeId?._id?.toString() : employeeId?.toString()) ||
      attendance.employeeId?.toString();

    if (!empId) {
      console.warn(`[auto-check-out] No valid employeeId found for attendance ${attendanceId}`);
      return;
    }

    const employee = await Employee.findById(empId).populate("department");
    if (!employee) {
      console.warn(`[auto-check-out] Employee not found for id: ${empId}`);
      return;
    }

    const checkInTime = moment(attendance.checkIn).tz(TZ).format("hh:mm A");
    const deptName = employee.department?.name || "your department";

    // Send reminder email
    await step.run("send-reminder-email", async () => {
      if (!employee.email) return;
      await sendEmail({
        to: employee.email,
        subject: "Attendance Check-Out Reminder",
        body: getEmailTemplate(
          `
<h2 style="
  margin:0 0 18px;
  font-size:24px;
  line-height:1.3;
  color:#111827;
  font-weight:700;
">
  Hi ${employee.firstName} 👋
</h2>

<p style="
  margin:0 0 18px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  Our records show that you are still checked in to
  <strong>${deptName}</strong>.
</p>

<div style="
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:16px;
  padding:22px;
  margin:24px 0;
">

  <div style="
    font-size:13px;
    color:#64748b;
    margin-bottom:8px;
  ">
    CHECK-IN TIME
  </div>

  <div style="
    font-size:30px;
    font-weight:800;
    color:#111827;
    letter-spacing:-0.03em;
  ">
    ${checkInTime}
  </div>

</div>

<div style="
  background:#fffbeb;
  border:1px solid #fde68a;
  color:#92400e;
  padding:16px 18px;
  border-radius:14px;
  margin:24px 0;
  font-size:14px;
  line-height:1.7;
">
  Please check out within the next hour to ensure your working hours are recorded accurately.
</div>

<p style="
  margin-top:20px;
  color:#6b7280;
  font-size:14px;
  line-height:1.7;
">
  If you already left the office, please contact your administrator.
</p>
        `,
          "Action Required: Check-Out Reminder",
        ),
      });
    });

    // After 14 hours total (1 more hour), mark attendance as checked out and keep status as present
    await step.sleepUntil(
      "wait-for-the-1-hour",
      moment().add(1, "hours").toDate(),
    );

    await connectDB();

    attendance = await Attendance.findById(attendanceId);
    if (!attendance || attendance.checkOut) {
      return;
    }

    const shiftConfig = await getAttendanceShiftConfig();
    const checkInMoment = moment(attendance.checkIn).tz(TZ);
    let checkOutMoment = getShiftEndMoment(checkInMoment, shiftConfig);

    // If check-in occurred at or after shift end time, set checkout to next day
    if (checkOutMoment.isSameOrBefore(checkInMoment)) {
      checkOutMoment.add(1, "day");
    }

    attendance.checkOut = checkOutMoment.toDate();
    const duration = Math.max(
      0,
      (attendance.checkOut - attendance.checkIn) / (1000 * 60 * 60),
    );
    attendance.workingHours = parseFloat(duration.toFixed(2));
    const { dayType } = determineAttendanceDayType(
      attendance.workingHours,
      shiftConfig,
    );
    attendance.dayType = dayType;
    attendance.status = AttendanceStatus.PRESENT;
    attendance.updatedBy = "System";
    attendance.adminUpdatedAt = new Date();
    await attendance.save();
    // Comp-off is not credited automatically; employee must submit a Comp-Off Request for admin approval
  },
);

// Send Email to admin, If admin doesn't take action on leave application within 24 hours
const leaveApplicationReminder = inngest.createFunction(
  { id: "leave-application-reminder", triggers: [{ event: "leave/pending" }] },
  async ({ event, step }) => {
    const { leaveApplicationId } = event.data;

    // wait for 24 hours
    await step.sleepUntil(
      "wait-for-the-24-hours",
      moment().add(24, "hours").toDate(),
    );

    await connectDB();

    const leaveApplication =
      await LeaveApplication.findById(leaveApplicationId);

    if (leaveApplication?.status === "PENDING") {
      const employee = await Employee.findById(
        leaveApplication.employeeId,
      ).populate("department");

      if (!employee) {
        console.warn(`[leave-application-reminder] Employee not found for leave ${leaveApplicationId}`);
        return;
      }

      const startDate = moment(leaveApplication?.startDate).format(
        "MMM DD, YYYY",
      );
      const deptName = employee.department?.name || "General";
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

      // Send reminder email to admin to take action on leave application
      await sendEmail({
        to: process.env.ADMIN_EMAIL,
        subject: `Pending Leave Action Required`,
        body: getEmailTemplate(
          `
<h2 style="
  margin:0 0 18px;
  font-size:24px;
  color:#111827;
  font-weight:700;
">
  Hi Admin 👋
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  A leave application is awaiting your approval from
  <strong>${employee.firstName} ${employee.lastName}</strong>.
</p>

<div style="
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:16px;
  padding:20px;
  margin:24px 0;
">

  <table width="100%" cellpadding="0" cellspacing="0">

    <tr>
      <td style="
        padding:0 0 14px;
        color:#64748b;
        font-size:14px;
      ">
        Department
      </td>

      <td align="right" style="
        padding:0 0 14px;
        color:#111827;
        font-size:14px;
        font-weight:600;
      ">
        ${deptName}
      </td>
    </tr>

    <tr>
      <td style="
        padding:14px 0;
        border-top:1px solid #e5e7eb;
        color:#64748b;
        font-size:14px;
      ">
        Leave Start
      </td>

      <td align="right" style="
        padding:14px 0;
        border-top:1px solid #e5e7eb;
        color:#111827;
        font-size:14px;
        font-weight:600;
      ">
        ${startDate}
      </td>
    </tr>

    <tr>
      <td style="
        padding:14px 0 0;
        border-top:1px solid #e5e7eb;
        color:#64748b;
        font-size:14px;
      ">
        Reason
      </td>

      <td align="right" style="
        padding:14px 0 0;
        border-top:1px solid #e5e7eb;
        color:#111827;
        font-size:14px;
        font-weight:500;
      ">
        ${leaveApplication?.reason}
      </td>
    </tr>

  </table>

</div>

<a href="${frontendUrl}/admin/leaves"
style="
  display:inline-block;
  background:#811c50;
  color:#ffffff;
  text-decoration:none;
  padding:14px 22px;
  border-radius:12px;
  font-size:14px;
  font-weight:600;
">
  Review Application
</a>
        `,
          "Leave Application Reminder",
        ),
      });
    }
  },
);

// Dynamic Shift Attendance Cron: Morning dispatcher at 6:00 AM IST daily
// 1. Checks if today is an official working day (skips holidays, Sundays, swapped off days)
// 2. Loads dynamic shift startTime configured in Settings (e.g. 10:00 AM)
// 3. Sleeps until (shiftStartTime - 15 minutes) and sends 15-minute early reminder to unpunched employees
// 4. Sleeps until shiftStartTime and sends missing attendance reminder to employees still absent
const attendanceReminderCron = inngest.createFunction(
  {
    id: "attendance-reminder-cron",
    triggers: [{ cron: "TZ=Asia/Kolkata 0 6 * * *" }],
  },
  async ({ step }) => {
    // Step 1: Check if today is a scheduled working day
    const isWorkingDay = await step.run("check-working-day", async () => {
      await connectDB();
      const todayStart = moment.tz(TZ).startOf("day").toDate();
      const todayEnd = moment.tz(TZ).endOf("day").toDate();

      const [holidays, overrides, weekOffConfigDoc] = await Promise.all([
        Holiday.find({ date: { $gte: todayStart, $lte: todayEnd } }).lean(),
        CalendarOverride.find({
          $or: [
            { date: { $gte: todayStart, $lte: todayEnd } },
            { swapDate: { $gte: todayStart, $lte: todayEnd } },
          ],
        }).lean(),
        Config.findOne({ key: "weekOffDays" }).lean(),
      ]);

      const schedule = getCalendarDaySchedule(todayStart, {
        overrides,
        holidays,
        weekOffConfig: weekOffConfigDoc?.value,
        timezone: TZ,
      });

      return schedule.isWorkingDay;
    });

    if (!isWorkingDay) {
      return { skipped: true, reason: "Today is an official holiday or weekly off" };
    }

    // Step 2: Load dynamic shift configuration
    const shiftTiming = await step.run("get-shift-timing", async () => {
      await connectDB();
      const shiftConfig = await getAttendanceShiftConfig();
      const todayYMD = moment.tz(TZ).format("YYYY-MM-DD");

      let startMoment = moment.tz(`${todayYMD} ${shiftConfig.startTime}`, "YYYY-MM-DD hh:mm A", TZ);
      if (!startMoment.isValid()) {
        startMoment = moment.tz(`${todayYMD} ${shiftConfig.startTime}`, "YYYY-MM-DD HH:mm", TZ);
      }
      if (!startMoment.isValid()) {
        startMoment = moment.tz(`${todayYMD} 10:00 AM`, "YYYY-MM-DD hh:mm A", TZ);
      }

      const earlyReminderMoment = startMoment.clone().subtract(15, "minutes");

      return {
        startTimeStr: shiftConfig.startTime || "10:00 AM",
        shiftStartISO: startMoment.toISOString(),
        earlyReminderISO: earlyReminderMoment.toISOString(),
      };
    });

    // Step 3: Wait for early reminder time (shiftStartTime - 15 minutes)
    const earlyMoment = moment(shiftTiming.earlyReminderISO);
    if (earlyMoment.isAfter(moment())) {
      await step.sleepUntil("wait-for-early-reminder", earlyMoment.toDate());
    }

    // Send 15-minute early reminder if we haven't already passed shift start
    if (moment().isBefore(moment(shiftTiming.shiftStartISO))) {
      await step.run("send-early-reminders", async () => {
        await connectDB();
        const todayStart = moment.tz(TZ).startOf("day").toDate();
        const todayEnd = moment.tz(TZ).endOf("day").toDate();

        const [activeEmployees, leaves, attendances] = await Promise.all([
          Employee.find({ isDeleted: false, employmentStatus: "ACTIVE" }).populate("department").lean(),
          LeaveApplication.find({
            status: "APPROVED",
            startDate: { $lte: todayEnd },
            endDate: { $gte: todayStart },
          }).lean(),
          Attendance.find({
            date: { $gte: todayStart, $lt: todayEnd },
          }).lean(),
        ]);

        const onLeaveIds = new Set(leaves.map((l) => l.employeeId.toString()));
        const checkedInIds = new Set(attendances.map((a) => a.employeeId.toString()));

        const pendingEmployees = activeEmployees.filter(
          (emp) => !onLeaveIds.has(emp._id.toString()) && !checkedInIds.has(emp._id.toString()),
        );

        if (pendingEmployees.length === 0) return { count: 0 };

        const todayStr = moment().tz(TZ).format("MMMM DD, YYYY");
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const startTimeStr = shiftTiming.startTimeStr;

        const emailPromises = pendingEmployees.map((emp) => {
          if (!emp.email) return Promise.resolve();
          return sendEmail({
            to: emp.email,
            subject: `Reminder: Shift Starts in 15 Minutes (${startTimeStr})`,
            body: getEmailTemplate(
              `
<h2 style="
  margin:0 0 16px;
  font-size:22px;
  color:#111827;
  font-weight:700;
">
  Good Morning, ${emp.firstName} 👋
</h2>

<p style="
  margin:0 0 18px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  This is a gentle reminder that your scheduled shift begins in <strong>15 minutes at ${startTimeStr} IST</strong> today (<strong>${todayStr}</strong>).
</p>

<div style="
  background:#f0fdf4;
  border:1px solid #bbf7d0;
  color:#166534;
  padding:18px;
  border-radius:14px;
  margin:22px 0;
">
  <div style="font-size:14px; font-weight:700; margin-bottom:4px;">
    Shift Start Time: ${startTimeStr} IST
  </div>
  <div style="font-size:13px; line-height:1.6;">
    Please remember to mark your attendance using the dashboard or attendance page on time.
  </div>
</div>

<div style="
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:14px;
  padding:14px 18px;
  margin:20px 0;
">
  <div style="font-size:12px; color:#64748b; margin-bottom:4px;">DEPARTMENT</div>
  <div style="font-size:14px; font-weight:600; color:#111827;">${emp.department?.name || "General"}</div>
</div>

<a href="${frontendUrl}/attendance"
style="
  display:inline-block;
  background:#811c50;
  color:#ffffff;
  text-decoration:none;
  padding:14px 22px;
  border-radius:12px;
  font-size:14px;
  font-weight:600;
">
  Clock In Now
</a>
              `,
              "Shift Early Reminder",
            ),
          });
        });

        await Promise.all(emailPromises);
        return { count: pendingEmployees.length };
      });
    }

    // Step 4: Wait for shift start deadline
    const shiftStart = moment(shiftTiming.shiftStartISO);
    if (shiftStart.isAfter(moment())) {
      await step.sleepUntil("wait-for-shift-deadline", shiftStart.toDate());
    }

    // Send missing attendance reminder to employees still absent at shift start time
    const result = await step.run("send-deadline-reminders", async () => {
      await connectDB();
      const todayStart = moment.tz(TZ).startOf("day").toDate();
      const todayEnd = moment.tz(TZ).endOf("day").toDate();

      const [activeEmployees, leaves, attendances] = await Promise.all([
        Employee.find({ isDeleted: false, employmentStatus: "ACTIVE" }).populate("department").lean(),
        LeaveApplication.find({
          status: "APPROVED",
          startDate: { $lte: todayEnd },
          endDate: { $gte: todayStart },
        }).lean(),
        Attendance.find({
          date: { $gte: todayStart, $lt: todayEnd },
        }).lean(),
      ]);

      const onLeaveIds = new Set(leaves.map((l) => l.employeeId.toString()));
      const checkedInIds = new Set(attendances.map((a) => a.employeeId.toString()));

      const absentEmployees = activeEmployees.filter(
        (emp) => !onLeaveIds.has(emp._id.toString()) && !checkedInIds.has(emp._id.toString()),
      );

      if (absentEmployees.length === 0) {
        return { absentCount: 0, emailsSent: 0 };
      }

      const todayStr = moment().tz(TZ).format("MMMM DD, YYYY");
      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const deadlineStr = shiftTiming.startTimeStr;

      const emailPromises = absentEmployees.map((emp) => {
        if (!emp.email) return Promise.resolve();
        return sendEmail({
          to: emp.email,
          subject: `Attendance Missing for ${todayStr}`,
          body: getEmailTemplate(
            `
<h2 style="
  margin:0 0 18px;
  font-size:24px;
  color:#111827;
  font-weight:700;
">
  Hi ${emp.firstName} 👋
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  We noticed that your attendance has not been marked for
  <strong>${todayStr}</strong>.
</p>

<div style="
  background:#fef2f2;
  border:1px solid #fecaca;
  color:#991b1b;
  padding:18px;
  border-radius:14px;
  margin:24px 0;
">

  <div style="
    font-size:14px;
    font-weight:700;
    margin-bottom:6px;
  ">
    Attendance Missing
  </div>

  <div style="
    font-size:14px;
    line-height:1.7;
  ">
    The check-in deadline was ${deadlineStr} IST.
    Please mark your attendance as soon as possible.
  </div>

</div>

<div style="
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:14px;
  padding:16px 18px;
  margin:24px 0;
">

  <div style="
    font-size:13px;
    color:#64748b;
    margin-bottom:6px;
  ">
    DEPARTMENT
  </div>

  <div style="
    font-size:15px;
    font-weight:600;
    color:#111827;
  ">
    ${emp.department?.name || "General"}
  </div>

</div>

<a href="${frontendUrl}/attendance"
style="
  display:inline-block;
  background:#811c50;
  color:#ffffff;
  text-decoration:none;
  padding:14px 22px;
  border-radius:12px;
  font-size:14px;
  font-weight:600;
">
  Mark Attendance
</a>
          `,
            "Attendance Reminder",
          ),
        });
      });

      await Promise.all(emailPromises);
      return { absentCount: absentEmployees.length, emailsSent: absentEmployees.length };
    });

    return result;
  },
);

export const celebrationWishesCron = inngest.createFunction(
  {
    id: "celebration-wishes-cron",
    triggers: [{ cron: "TZ=Asia/Kolkata 0 9 * * *" }],
  },
  async ({ step }) => {
    return await step.run("send-celebration-wishes", async () => {
      const { sendDailyAutomatedCelebrationWishes } = await import(
        "../utils/celebrations.js"
      );
      return await sendDailyAutomatedCelebrationWishes();
    });
  },
);

// Create an array where we export Inngest functions
export const functions = [
  autoCheckOut,
  leaveApplicationReminder,
  attendanceReminderCron,
  celebrationWishesCron,
];

