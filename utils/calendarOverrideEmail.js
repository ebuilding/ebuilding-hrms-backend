import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import sendEmail from "../config/nodemailer.js";
import { getEmailTemplate } from "./emailTemplates.js";
import { CalendarOverrideType } from "../constants/enums.js";

const TIMEZONE = "Asia/Kolkata";

/**
 * Sends notification emails to all active employees regarding a calendar override,
 * including specific leave reversal and refund details for affected employees.
 *
 * @param {Object} override - The created CalendarOverride document
 * @param {Array} affectedLeaves - List of affected leaves reverted by this override
 */
export const sendCalendarOverrideNotifications = async (override, affectedLeaves = []) => {
  try {
    const activeEmployees = await Employee.find({
      isDeleted: false,
      approvalStatus: "APPROVED",
    }).select("firstName lastName email leaveBalance");

    if (!activeEmployees || activeEmployees.length === 0) return;

    // Create a map of affected leaves by employeeId string
    const affectedMap = new Map();
    for (const item of affectedLeaves) {
      affectedMap.set(item.employeeId.toString(), item);
    }

    const dateFormatted = moment(override.date).tz(TIMEZONE).format("dddd, MMMM D, YYYY");
    const swapDateFormatted = override.swapDate
      ? moment(override.swapDate).tz(TIMEZONE).format("dddd, MMMM D, YYYY")
      : null;

    let typeTitle = "Calendar Schedule Notice";
    let typeDescription = "";

    if (override.type === CalendarOverrideType.HOLIDAY) {
      typeTitle = "Company Holiday Declared";
      typeDescription = `A working day has been officially declared as a <strong>Company Holiday / Rest Day</strong>. Normal shifts will not be scheduled on this day.`;
    } else if (override.type === CalendarOverrideType.WORKING_DAY) {
      typeTitle = "Mandatory Working Day";
      typeDescription = `This date has been officially designated as an active <strong>Working Day</strong> for all company personnel.`;
    } else if (override.type === CalendarOverrideType.SWAP) {
      typeTitle = "Compensatory Working Day Swap";
      typeDescription = `A 1-to-1 schedule swap has been scheduled: <strong>${dateFormatted}</strong> is declared an <strong>Off Day</strong>, and <strong>${swapDateFormatted}</strong> is designated as the <strong>Compensatory Working Day</strong>.`;
    }

    for (const emp of activeEmployees) {
      if (!emp.email) continue;

      const affected = affectedMap.get(emp._id.toString());
      const hasReversedLeave = Boolean(affected && affected.refundedDays > 0);

      const subject = hasReversedLeave
        ? `[Notice] Calendar Schedule Update & Leave Reversal — ${override.title}`
        : `[Notice] Calendar Schedule Update — ${override.title}`;

      let contentHtml = `
        <div style="font-size:15px; color:#1f2937; line-height:1.6;">
          <p style="margin-top:0;">Hello <strong>${emp.firstName}</strong>,</p>
          <p>Please be advised that the administration has updated the official company work calendar with the following schedule directive:</p>

          <div style="
            background:#f8fafc;
            border:1px solid #e2e8f0;
            border-left:4px solid #811c50;
            border-radius:10px;
            padding:16px 20px;
            margin:20px 0;
          ">
            <div style="font-size:16px; font-weight:700; color:#811c50; margin-bottom:8px;">
              ${override.title}
            </div>
            <div style="font-size:13px; color:#475569; margin-bottom:6px;">
              <strong>Date:</strong> ${dateFormatted}
            </div>
            ${
              override.type === CalendarOverrideType.SWAP && swapDateFormatted
                ? `<div style="font-size:13px; color:#475569; margin-bottom:6px;">
                     <strong>Compensatory Working Date:</strong> ${swapDateFormatted}
                   </div>`
                : ""
            }
            <div style="font-size:13px; color:#475569; margin-top:8px;">
              ${typeDescription}
            </div>
            ${
              override.reason
                ? `<div style="margin-top:10px; font-size:12px; color:#64748b; font-style:italic; border-top:1px dashed #cbd5e1; pt-2; padding-top:6px;">
                     <strong>Admin Note / Reason:</strong> ${override.reason}
                   </div>`
                : ""
            }
          </div>
      `;

      if (hasReversedLeave) {
        contentHtml += `
          <div style="
            background:#fef2f2;
            border:1px solid #fecaca;
            border-radius:12px;
            padding:18px 20px;
            margin:24px 0;
          ">
            <div style="display:flex; align-items:center; gap:8px; font-size:15px; font-weight:700; color:#991b1b; margin-bottom:8px;">
              Important: Your Applied Leave Has Been Reverted
            </div>
            <p style="font-size:13px; color:#7f1d1d; margin:0 0 10px 0;">
              Because <strong>${dateFormatted}</strong> has been declared an official company holiday, your leave applied for this day has been automatically <strong>REVERTED</strong>.
            </p>
            <div style="
              background:#ffffff;
              border:1px solid #fee2e2;
              border-radius:8px;
              padding:12px 16px;
              font-size:13px;
              color:#374151;
            ">
              <div style="margin-bottom:4px;">
                <strong>Refunded Days:</strong> +${affected.refundedDays} day(s)
              </div>
              <div style="margin-bottom:4px;">
                <strong>Leave Category:</strong> ${affected.leaveType}
              </div>
              <div>
                <strong>Balance Status:</strong> Your leave quota has been credited back to your account.
              </div>
            </div>
            <p style="font-size:12px; color:#991b1b; margin:10px 0 0 0; opacity:0.85;">
              * Note: If the administration removes this holiday override in the future, you will need to re-apply for leave manually if you still wish to take time off.
            </p>
          </div>
        `;
      }

      contentHtml += `
          <p style="font-size:13px; color:#6b7280; margin-top:20px;">
            You can view the full updated schedule at any time on your company dashboard and holiday calendar.
          </p>
        </div>
      `;

      const fullEmailHtml = getEmailTemplate(contentHtml, typeTitle);

      try {
        await sendEmail({
          to: emp.email,
          subject,
          body: fullEmailHtml,
        });
      } catch (err) {
        console.error(`Failed to send calendar override email to ${emp.email}:`, err.message);
      }
    }
  } catch (error) {
    console.error("sendCalendarOverrideNotifications Error:", error);
  }
};
