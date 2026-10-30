/**
 * Centralized Application Enums (Backend)
 */

export const UserRole = Object.freeze({
  ADMIN: "ADMIN",
  EMPLOYEE: "EMPLOYEE",
});

export const ApprovalStatus = Object.freeze({
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  REJECTED: "REJECTED",
  REVOKED: "REVOKED",
});

export const EmploymentStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});

export const Gender = Object.freeze({
  MALE: "MALE",
  FEMALE: "FEMALE",
  OTHER: "OTHER",
});

export const MaritalStatus = Object.freeze({
  SINGLE: "SINGLE",
  MARRIED: "MARRIED",
  DIVORCED: "DIVORCED",
  WIDOWED: "WIDOWED",
});

export const InviteFilterStatus = Object.freeze({
  ALL: "ALL",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  PENDING: "PENDING",
  REVOKED: "REVOKED",
});

export const CandidateFilterStatus = Object.freeze({
  ALL: "ALL",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REVOKED: "REVOKED",
});

export const CalendarOverrideType = Object.freeze({
  HOLIDAY: "HOLIDAY",
  WORKING_DAY: "WORKING_DAY",
  SWAP: "SWAP",
});

export const LeaveType = Object.freeze({
  PAID: "PAID",
  UNPAID: "UNPAID",
  COMP_OFF: "COMP_OFF",
});

export const LeaveStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  REVERTED: "REVERTED",
  REVOKE_REQUESTED: "REVOKE_REQUESTED",
});

export const CompOffRequestStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

export const HalfDayType = Object.freeze({
  FIRST_HALF: "FIRST_HALF",
  SECOND_HALF: "SECOND_HALF",
});

export const AttendanceStatus = Object.freeze({
  PRESENT: "PRESENT",
  LEAVE: "LEAVE",
  NOT_MARKED: "NOT_MARKED",
  HOLIDAY: "HOLIDAY",
  WEEK_OFF: "WEEK_OFF",
  HALF_DAY: "HALF_DAY",
  NOT_JOINED: "NOT_JOINED",
});

export const AttendanceStatusLabel = Object.freeze({
  [AttendanceStatus.PRESENT]: "Present",
  [AttendanceStatus.HALF_DAY]: "Half Day",
  [AttendanceStatus.LEAVE]: "Leave",
  [AttendanceStatus.NOT_MARKED]: "Not Marked",
  [AttendanceStatus.HOLIDAY]: "Holiday",
  [AttendanceStatus.WEEK_OFF]: "Week Off",
  [AttendanceStatus.NOT_JOINED]: "Not Joined",
});

export const ReportFilterType = Object.freeze({
  ALL: "ALL",
  MISSED: "MISSED",
  PERFECT: "PERFECT",
});

export const ReportViewTab = Object.freeze({
  SUMMARY: "summary",
  DETAILED: "detailed",
});

export const ReportCategory = Object.freeze({
  ATTENDANCE: "ATTENDANCE",
  LEAVE: "LEAVE",
});

export const ReportExportType = Object.freeze({
  SUMMARY: "summary",
  DETAILED: "detailed",
  ALL: "all",
});

export const DayType = Object.freeze({
  FULL_DAY: "Full Day",
  HALF_DAY: "Half Day",
});

export const CompOffType = Object.freeze({
  WEEK_OFF: "Week Off",
  HOLIDAY: "Holiday",
  OTHER: "Other",
});

export const PasswordResetReason = Object.freeze({
  MISSING: "missing",
  INVALID: "invalid",
  EXPIRED: "expired",
  SERVER_ERROR: "server_error",
});

export const PasswordResetConfig = Object.freeze({
  EXPIRY_MINUTES: 5,
  COOLDOWN_SECONDS: 60,
  MAX_REQUESTS_PER_WINDOW: 5,
  RATE_LIMIT_WINDOW_MINUTES: 15,
});

export default {
  UserRole,
  ApprovalStatus,
  EmploymentStatus,
  Gender,
  MaritalStatus,
  InviteFilterStatus,
  CandidateFilterStatus,
  CalendarOverrideType,
  LeaveType,
  LeaveStatus,
  CompOffRequestStatus,
  HalfDayType,
  AttendanceStatus,
  DayType,
  CompOffType,
  PasswordResetReason,
  PasswordResetConfig,
};

