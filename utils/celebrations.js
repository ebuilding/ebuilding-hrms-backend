import moment from "moment-timezone";
import Employee from "../models/Employee.js";
import Department from "../models/Department.js";
import sendEmail from "../config/nodemailer.js";
import {
  getBirthdayWishEmail,
  getWorkAnniversaryWishEmail,
} from "./emailTemplates.js";

const TZ = "Asia/Kolkata";

/**
 * Calculates today and upcoming celebrations (Birthdays & Work Anniversaries)
 * @param {number} daysWindow - Lookahead window in days (default 30)
 */
export const getCelebrationsData = async (daysWindow = 30) => {
  const employees = await Employee.find({ isDeleted: { $ne: true } })
    .populate("department", "name")
    .select("firstName lastName email position department profile_img joinDate personalInfo")
    .lean();

  const now = moment.tz(TZ);
  const todayStart = now.clone().startOf("day");
  const todayMMDD = now.format("MM-DD");

  const today = [];
  const upcoming = [];

  for (const emp of employees) {
    const fullName = `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
    const deptName = emp.department?.name || "General";

    // 1. Birthday Check
    if (emp.personalInfo?.dob) {
      const dob = moment(emp.personalInfo.dob);
      if (dob.isValid()) {
        const dobMMDD = dob.format("MM-DD");
        // Next occurrence in current year or next year
        let nextBday = moment.tz(`${now.year()}-${dobMMDD}`, "YYYY-MM-DD", TZ).startOf("day");
        if (nextBday.isBefore(todayStart)) {
          nextBday.add(1, "year");
        }

        const daysLeft = nextBday.diff(todayStart, "days");

        const isDeliveredToday = daysLeft === 0 && now.hour() >= 9;
        const autoWishMessage =
          daysLeft === 0
            ? `🎂 Happy Birthday, ${emp.firstName}! May your special day bring you immense joy, good health, and abundant success. Best wishes from the entire team!`
            : `🎂 Wishing ${emp.firstName} a very happy birthday in advance! Scheduled for automatic dispatch on ${nextBday.format("MMM DD")}.`;

        const bdayItem = {
          id: `${emp._id}-bday`,
          employeeId: emp._id.toString(),
          name: fullName,
          firstName: emp.firstName,
          email: emp.email,
          position: emp.position,
          department: deptName,
          profile_img: emp.profile_img || "",
          type: "BIRTHDAY",
          dateStr: nextBday.format("MMM DD"),
          fullDate: nextBday.format("YYYY-MM-DD"),
          daysLeft,
          isToday: daysLeft === 0,
          isAutoGreeted: isDeliveredToday,
          autoSchedule: "09:00 AM IST",
          autoGreetingStatus:
            daysLeft === 0
              ? isDeliveredToday
                ? "Auto-greeting sent today at 09:00 AM"
                : "Auto-scheduled for today at 09:00 AM"
              : `Auto-scheduled for ${nextBday.format("MMM DD")} at 09:00 AM`,
          autoWishMessage,
        };

        if (daysLeft === 0) {
          today.push(bdayItem);
        } else if (daysLeft > 0 && daysLeft <= daysWindow) {
          upcoming.push(bdayItem);
        }
      }
    }

    // 2. Work Anniversary Check
    if (emp.joinDate) {
      const joinMoment = moment(emp.joinDate).tz(TZ);
      if (joinMoment.isValid() && joinMoment.isBefore(todayStart)) {
        const joinMMDD = joinMoment.format("MM-DD");
        let nextAnniv = moment.tz(`${now.year()}-${joinMMDD}`, "YYYY-MM-DD", TZ).startOf("day");
        if (nextAnniv.isBefore(todayStart)) {
          nextAnniv.add(1, "year");
        }

        const daysLeft = nextAnniv.diff(todayStart, "days");
        const yearsCompleted = nextAnniv.year() - joinMoment.year();

        if (yearsCompleted > 0) {
          const isDeliveredToday = daysLeft === 0 && now.hour() >= 9;
          const autoWishMessage =
            daysLeft === 0
              ? `🏆 Happy ${yearsCompleted}-Year Work Anniversary, ${emp.firstName}! Thank you for your leadership, dedication, and incredible contributions to our journey!`
              : `🏆 Celebrating ${yearsCompleted} years with us! Automated greeting scheduled for delivery on ${nextAnniv.format("MMM DD")}.`;

          const annivItem = {
            id: `${emp._id}-anniv`,
            employeeId: emp._id.toString(),
            name: fullName,
            firstName: emp.firstName,
            email: emp.email,
            position: emp.position,
            department: deptName,
            profile_img: emp.profile_img || "",
            type: "ANNIVERSARY",
            yearsCompleted,
            dateStr: nextAnniv.format("MMM DD"),
            fullDate: nextAnniv.format("YYYY-MM-DD"),
            daysLeft,
            isToday: daysLeft === 0,
            isAutoGreeted: isDeliveredToday,
            autoSchedule: "09:00 AM IST",
            autoGreetingStatus:
              daysLeft === 0
                ? isDeliveredToday
                  ? "Auto-greeting sent today at 09:00 AM"
                  : "Auto-scheduled for today at 09:00 AM"
                : `Auto-scheduled for ${nextAnniv.format("MMM DD")} at 09:00 AM`,
            autoWishMessage,
          };

          if (daysLeft === 0) {
            today.push(annivItem);
          } else if (daysLeft > 0 && daysLeft <= daysWindow) {
            upcoming.push(annivItem);
          }
        }
      }
    }
  }

  // Sort upcoming by daysLeft ascending
  upcoming.sort((a, b) => a.daysLeft - b.daysLeft);

  return { today, upcoming };
};

/**
 * Sends a celebration email (Birthday or Work Anniversary)
 */
export const sendCelebrationWish = async ({
  employeeId,
  type,
  customMessage = "",
}) => {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw new Error("Employee not found");
  }

  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const companyName = "E Building HRMS";

  let subject = "";
  let html = "";

  if (type === "ANNIVERSARY") {
    const now = moment.tz(TZ);
    const joinMoment = moment(employee.joinDate).tz(TZ);
    const years = Math.max(1, now.year() - joinMoment.year());

    subject = `Happy Work Anniversary, ${employee.firstName}! 🎉`;
    html = getWorkAnniversaryWishEmail({
      name,
      years,
      companyName,
      customMessage,
    });
  } else {
    // BIRTHDAY
    subject = `Happy Birthday, ${employee.firstName}! 🎂🎉`;
    html = getBirthdayWishEmail({
      name,
      companyName,
      customMessage,
    });
  }

  await sendEmail({
    to: employee.email,
    subject,
    body: html,
  });

  return {
    success: true,
    recipient: employee.email,
    employeeName: name,
    type,
  };
};

/**
 * Automatically sends celebration emails for today's birthdays and work anniversaries (invoked by daily cron)
 */
export const sendDailyAutomatedCelebrationWishes = async () => {
  try {
    const { today } = await getCelebrationsData(0);
    if (!today.length) {
      return { total: 0, sent: 0, skipped: 0 };
    }

    let sent = 0;
    for (const item of today) {
      try {
        await sendCelebrationWish({
          employeeId: item.employeeId,
          type: item.type,
        });
        sent++;
      } catch (err) {
        console.error(`Failed to send celebration wish to ${item.name}:`, err);
      }
    }

    return { total: today.length, sent };
  } catch (error) {
    console.error("Daily automated celebration wishes error:", error);
    return { error: error.message };
  }
};
