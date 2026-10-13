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

export default {
  UserRole,
  ApprovalStatus,
  EmploymentStatus,
  Gender,
  MaritalStatus,
  InviteFilterStatus,
  CandidateFilterStatus,
};
