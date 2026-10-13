import Employee from "../models/Employee.js";
import bcrypt from "bcrypt";
import User from "../models/User.js";
import Attendance from "../models/Attendance.js";
import moment from "moment-timezone";
import sendEmail from "../config/nodemailer.js";
import { getWelcomeCredentialsEmail } from "../utils/emailTemplates.js";
import { createEmployeeSchema } from "../validators/employeeValidator.js";
import {
  ApprovalStatus,
  EmploymentStatus,
  UserRole,
} from "../constants/enums.js";

const TZ = "Asia/Kolkata";

// Get employees
// GET /api/employees
export const getEmployees = async (req, res) => {
  try {
    const { department } = req.query;
    const where = {
      $or: [
        { approvalStatus: ApprovalStatus.APPROVED },
        { approvalStatus: { $exists: false } },
      ],
    };
    if (department) where.department = department;

    let employees = await Employee.find(where)
      .select("-bankDetails -personalInfo -documents")
      .sort({ createdAt: -1 })
      .populate("userId", "email role")
      .populate("department", "name")
      .lean();

    const todayStart = moment.tz(TZ).startOf("day").toDate();
    const todayEnd = moment.tz(TZ).endOf("day").toDate();

    const attendances = await Attendance.find({
      date: { $gte: todayStart, $lte: todayEnd },
    }).lean();

    const result = employees.map((emp) => {
      const empAttendance = attendances.find(
        (a) => a.employeeId.toString() === emp._id.toString(),
      );
      return {
        ...emp,
        id: emp._id.toString(),
        departmentName: emp.department?.name || "Unassigned",
        user: emp.userId
          ? { email: emp.userId.email, role: emp.userId.role }
          : null,
        todayAttendance: empAttendance || null,
      };
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to fetch employees" });
  }
};

// Get single employee
// GET /api/employees/:id
export const getEmployeeById = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id)
      .populate("userId", "email role")
      .populate("department", "name")
      .lean();

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const result = {
      ...employee,
      id: employee._id.toString(),
      departmentName: employee.department?.name || "Unassigned",
      user: employee.userId
        ? { email: employee.userId.email, role: employee.userId.role }
        : null,
    };
    return res.json(result);
  } catch (error) {
    console.error("Get employee by ID error:", error);
    return res.status(500).json({ error: "Failed to fetch employee details" });
  }
};

// Create employee
// POST /api/employees
export const createEmployee = async (req, res) => {
  try {
    const parseResult = createEmployeeSchema.safeParse(req.body);
    if (!parseResult.success) {
      const firstError =
        parseResult.error.issues?.[0]?.message ||
        parseResult.error.errors?.[0]?.message ||
        "Validation failed";
      return res.status(400).json({
        error: firstError,
        details: parseResult.error.flatten?.().fieldErrors || {},
      });
    }

    const {
      firstName,
      lastName,
      email,
      phone,
      position,
      department,
      basicSalary,
      allowances,
      deductions,
      joinDate,
      password,
      role,
      bio,
      profile_img,
      shiftHours,
      employmentStatus,
    } = parseResult.data;

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: normalizedEmail,
      password: hashed,
      role: role || UserRole.EMPLOYEE,
    });

    const employee = await Employee.create({
      userId: user._id,
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      position,
      department,
      basicSalary,
      allowances,
      deductions,
      joinDate: new Date(joinDate),
      bio,
      profile_img,
      shiftHours,
      employmentStatus,
    });

    // Send welcome email with login credentials
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    let emailSent = false;
    let emailError = null;

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Welcome to E Building HRMS - Your Login Credentials",
        body: getWelcomeCredentialsEmail({
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: normalizedEmail,
          password: password,
          loginUrl: `${frontendUrl}/login`,
          position: employee.position,
        }),
      });
      emailSent = true;
    } catch (err) {
      emailError = err.message;
      console.error(`Failed to send credentials email to ${normalizedEmail}:`, err);
    }

    return res.status(201).json({
      success: true,
      employee,
      emailSent,
      ...(emailError ? { emailWarning: "Employee created, but credential email could not be sent. Check SMTP settings." } : {}),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Create employee error:", error);
    return res.status(500).json({ error: error.message || "Failed to create employee" });
  }
};

// Update employee
// PUT /api/employees/:id
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const employee = await Employee.findById(id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    const { password, role, email, ...employeeData } = req.body;

    // Update employee fields (including nested objects)
    Object.keys(employeeData).forEach((key) => {
      if (employeeData[key] !== undefined) {
        employee[key] = employeeData[key];
      }
    });

    await employee.save();

    // Update user record if email, role, or password is changed
    const userUpdate = {};
    if (email) {
      userUpdate.email = email;
      employee.email = email;
      await employee.save();
    }
    if (role) userUpdate.role = role;
    if (password && password.trim() !== "") {
      userUpdate.password = await bcrypt.hash(password, 10);
    }

    if (Object.keys(userUpdate).length > 0) {
      await User.findByIdAndUpdate(employee.userId, userUpdate);
    }

    return res.json({ success: true, message: "Updated successfully" });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Update employee error:", error);
    return res.status(500).json({ error: "Failed to update employee" });
  }
};

// Delete employee
// DELETE /api/employees/:id
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await Employee.findById(id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });

    employee.isDeleted = true;
    employee.employmentStatus = EmploymentStatus.INACTIVE;
    await employee.save();
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete employee" });
  }
};
