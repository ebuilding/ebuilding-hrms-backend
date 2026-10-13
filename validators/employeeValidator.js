import { z } from "zod";
import { UserRole, EmploymentStatus } from "../constants/enums.js";

export const createEmployeeSchema = z.object({
  firstName: z
    .string({
      error: "First name is required",
      required_error: "First name is required",
      invalid_type_error: "First name must be a string",
    })
    .trim()
    .min(1, "First name cannot be empty"),

  lastName: z
    .string({
      error: "Last name is required",
      required_error: "Last name is required",
      invalid_type_error: "Last name must be a string",
    })
    .trim()
    .min(1, "Last name cannot be empty"),

  email: z
    .string({
      error: "Email is required",
      required_error: "Email is required",
      invalid_type_error: "Email must be a string",
    })
    .trim()
    .min(1, "Email cannot be empty")
    .email("Please enter a valid email address"),

  phone: z
    .string({
      error: "Mobile number is required",
      required_error: "Mobile number is required",
      invalid_type_error: "Mobile number must be a string",
    })
    .trim()
    .min(1, "Mobile number cannot be empty")
    .regex(/^[0-9]{10}$/, "Mobile number must be a valid 10-digit number"),

  position: z
    .string({
      error: "Job position is required",
      required_error: "Job position is required",
      invalid_type_error: "Job position must be a string",
    })
    .trim()
    .min(1, "Job position cannot be empty"),

  department: z
    .string({
      error: "Department is required",
      required_error: "Department is required",
      invalid_type_error: "Department must be a string",
    })
    .trim()
    .min(1, "Department cannot be empty"),

  joinDate: z
    .string({
      error: "Join date is required",
      required_error: "Join date is required",
      invalid_type_error: "Join date must be a valid date string",
    })
    .or(z.date({ error: "Join date is required" }))
    .refine(
      (val) => !isNaN(new Date(val).getTime()),
      "Join date must be a valid date",
    ),

  password: z
    .string({
      error: "Temporary password is required",
      required_error: "Temporary password is required",
      invalid_type_error: "Temporary password must be a string",
    })
    .min(1, "Temporary password cannot be empty")
    .min(8, "Temporary password must be at least 8 characters long"),

  role: z
    .enum([UserRole.EMPLOYEE], {
      invalid_type_error: `Role must be ${UserRole.EMPLOYEE}`,
    })
    .optional()
    .default(UserRole.EMPLOYEE),

  basicSalary: z.coerce
    .number({
      invalid_type_error: "Basic salary must be a number",
    })
    .min(0, "Basic salary cannot be negative")
    .optional()
    .default(0),

  allowances: z.coerce
    .number({
      invalid_type_error: "Allowances must be a number",
    })
    .min(0, "Allowances cannot be negative")
    .optional()
    .default(0),

  deductions: z.coerce
    .number({
      invalid_type_error: "Deductions must be a number",
    })
    .min(0, "Deductions cannot be negative")
    .optional()
    .default(0),

  shiftHours: z.coerce
    .number({
      invalid_type_error: "Shift hours must be a number",
    })
    .min(0, "Shift hours cannot be negative")
    .max(24, "Shift hours cannot exceed 24")
    .optional()
    .default(8),

  bio: z.string().trim().optional().default(""),
  profile_img: z.string().optional().default(""),

  employmentStatus: z
    .enum([EmploymentStatus.ACTIVE, EmploymentStatus.INACTIVE], {
      invalid_type_error: `Employment status must be ${EmploymentStatus.ACTIVE} or ${EmploymentStatus.INACTIVE}`,
    })
    .optional()
    .default(EmploymentStatus.ACTIVE),
});

export const registerEmployeeSchema = z.object({
  firstName: z
    .string({
      error: "First name is required",
      required_error: "First name is required",
      invalid_type_error: "First name must be a string",
    })
    .trim()
    .min(1, "First name cannot be empty"),

  lastName: z
    .string({
      error: "Last name is required",
      required_error: "Last name is required",
      invalid_type_error: "Last name must be a string",
    })
    .trim()
    .min(1, "Last name cannot be empty"),

  email: z
    .string({
      error: "Email is required",
      required_error: "Email is required",
      invalid_type_error: "Email must be a string",
    })
    .trim()
    .min(1, "Email cannot be empty")
    .email("Please enter a valid email address"),

  phone: z
    .string({
      error: "Mobile number is required",
      required_error: "Mobile number is required",
      invalid_type_error: "Mobile number must be a string",
    })
    .trim()
    .min(1, "Mobile number cannot be empty")
    .regex(/^[0-9]{10}$/, "Mobile number must be a valid 10-digit number"),

  password: z
    .string({
      error: "Password is required",
      required_error: "Password is required",
      invalid_type_error: "Password must be a string",
    })
    .min(1, "Password cannot be empty")
    .min(8, "Password must be at least 8 characters long"),

  department: z
    .string({
      error: "Department is required",
      required_error: "Department is required",
      invalid_type_error: "Department must be a string",
    })
    .trim()
    .min(1, "Department cannot be empty"),

  position: z
    .string({
      error: "Job position is required",
      required_error: "Job position is required",
      invalid_type_error: "Job position must be a string",
    })
    .trim()
    .min(1, "Job position cannot be empty"),

  joinDate: z
    .string({
      invalid_type_error: "Join date must be a valid date string",
    })
    .or(z.date())
    .optional(),

  bio: z.string().trim().optional().default(""),
  profile_img: z.string().optional().default(""),
});

export default {
  createEmployeeSchema,
  registerEmployeeSchema,
};
