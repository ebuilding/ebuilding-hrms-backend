import moment from "moment-timezone";
import { Inngest } from "inngest";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";
import LeaveApplication from "../models/LeaveApplication.js";
import sendEmail from "../config/nodemailer.js";
import { creditCompOffForAttendance } from "../utils/compOff.js";

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
    const { employeeId, attendanceId } = event.data;

    // Wait for 13 hours
    await step.sleepUntil(
      "wait-for-the-13-hours",
      moment().add(13, "hours").toDate(),
    );

    // get Attendance data
    let attendance = await Attendance.findById(attendanceId);

    if (!attendance?.checkOut) {
      // get Employee data (Populate department)
      const employee =
        await Employee.findById(employeeId).populate("department");

      const checkInTime = moment(attendance?.checkIn).tz(TZ).format("hh:mm A");
      const deptName = employee.department?.name || "your department";

      // Send reminder email
      await step.run("send-reminder-email", async () => {
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

      // After 14 hours, mark attendance as checked out and keep status as present
      await step.sleepUntil(
        "wait-for-the-1-hour",
        moment().add(1, "hours").toDate(),
      );

      attendance = await Attendance.findById(attendanceId);
      if (!attendance?.checkOut) {
        attendance.checkOut = moment(attendance.checkIn)
          .add(9, "hours")
          .toDate();
        attendance.workingHours = 9;
        attendance.dayType = "Full Day";
        attendance.status = "PRESENT";
        attendance.updatedBy = "System";
        attendance.adminUpdatedAt = new Date();
        await attendance.save();
        await creditCompOffForAttendance(attendance);
      }
    }
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

    const leaveApplication =
      await LeaveApplication.findById(leaveApplicationId);

    if (leaveApplication?.status === "PENDING") {
      const employee = await Employee.findById(
        leaveApplication.employeeId,
      ).populate("department");
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

// Cron: Check attendance at 10:00 AM IST and email absent employees
const attendanceReminderCron = inngest.createFunction(
  {
    id: "attendance-reminder-cron",
    triggers: [{ cron: "TZ=Asia/Kolkata 0 10 * * *" }],
  },
  async ({ step }) => {
    // Step 1: Get today's date range (IST)
    const todayRange = await step.run("get-today-date", () => {
      const start = moment.tz(TZ).startOf("day");
      const end = start.clone().endOf("day");
      return { startUTC: start.toISOString(), endUTC: end.toISOString() };
    });

    // Step 2: Get all active, non-deleted employees (Populate department)
    const activeEmployees = await step.run("get-active-employees", async () => {
      const employees = await Employee.find({
        isDeleted: false,
        employmentStatus: "ACTIVE",
      })
        .populate("department")
        .lean();
      return employees.map((e) => ({
        _id: e._id.toString(),
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        departmentName: e.department?.name || "General",
      }));
    });

    // Step 3: Get employee IDs on approved leave today
    const onLeaveIds = await step.run("get-on-leave-ids", async () => {
      const leaves = await LeaveApplication.find({
        status: "APPROVED",
        startDate: { $lte: new Date(todayRange.endUTC) },
        endDate: { $gte: new Date(todayRange.startUTC) },
      }).lean();
      return leaves.map((l) => l.employeeId.toString());
    });

    // Step 4: Get employee IDs who already checked in today
    const checkedInIds = await step.run("get-checked-in-ids", async () => {
      const attendances = await Attendance.find({
        date: {
          $gte: new Date(todayRange.startUTC),
          $lt: new Date(todayRange.endUTC),
        },
      }).lean();
      return attendances.map((a) => a.employeeId.toString());
    });

    // Step 5: Filter absent employees (not on leave & not checked in)
    const absentEmployees = activeEmployees.filter(
      (emp) => !onLeaveIds.includes(emp._id) && !checkedInIds.includes(emp._id),
    );

    // Step 6: Send reminder emails
    if (absentEmployees.length > 0) {
      await step.run("send-reminder-emails", async () => {
        const todayStr = moment().tz(TZ).format("MMMM DD, YYYY");
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        const emailPromises = absentEmployees.map((emp) => {
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
    The check-in deadline was 10:00 AM IST.
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
    ${emp.departmentName}
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
        return { emailsSent: absentEmployees.length };
      });
    }

    return {
      totalActive: activeEmployees.length,
      onLeave: onLeaveIds.length,
      checkedIn: checkedInIds.length,
      absent: absentEmployees.length,
    };
  },
);

// The annual leave reset is now handled dynamically by the paidLeave engine 
// and idempotency keys, so we no longer hardcode a January 1st reset.

// Create an empty array where we'll export future Inngest functions
export const functions = [
  autoCheckOut,
  leaveApplicationReminder,
  attendanceReminderCron,
];
