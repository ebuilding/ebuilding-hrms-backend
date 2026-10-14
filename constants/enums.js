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

export const LeaveType = Object.freeze({
  PAID: "PAID",
  UNPAID: "UNPAID",
  COMP_OFF: "COMP_OFF",
});

export const LeaveStatus = Object.freeze({
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
});

export const DayType = Object.freeze({
  FULL_DAY: "Full Day",
  HALF_DAY: "Half Day",
});

export default {
  UserRole,
  ApprovalStatus,
  EmploymentStatus,
  Gender,
  MaritalStatus,
  InviteFilterStatus,
  CandidateFilterStatus,
  LeaveType,
  LeaveStatus,
  HalfDayType,
  AttendanceStatus,
  DayType,
};
