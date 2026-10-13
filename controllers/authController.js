import User from "../models/User.js";
import Employee from "../models/Employee.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import sendEmail from "../config/nodemailer.js";
import { getRegistrationPendingApprovalEmail } from "../utils/emailTemplates.js";
import { registerEmployeeSchema } from "../validators/employeeValidator.js";
import RegistrationInvite from "../models/RegistrationInvite.js";
import {
  ApprovalStatus,
  EmploymentStatus,
  UserRole,
} from "../constants/enums.js";

// Login for employee and admin
// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if user is pending admin approval
    if (user.isApproved === false) {
      return res.status(403).json({
        error:
          "Your registration is pending administrator approval. You will receive an email once approved.",
      });
    }

    const employee = await Employee.findOne({ userId: user._id });
    if (employee) {
      if (employee.approvalStatus === ApprovalStatus.PENDING) {
        return res.status(403).json({
          error:
            "Your registration is pending administrator approval. You will receive an email once approved.",
        });
      }
      if (employee.approvalStatus === ApprovalStatus.REJECTED) {
        return res.status(403).json({
          error:
            "Your registration application was not approved. Please contact your company administrator.",
        });
      }
      if (employee.approvalStatus === ApprovalStatus.REVOKED) {
        return res.status(403).json({
          error:
            "Your account access has been revoked by an administrator. Please contact your company administrator.",
        });
      }
    }

    const payload = {
      userId: user._id.toString(),
      role: user.role,
      email: user.email,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({ user: payload, token });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
};

// Get session for employee and admin
// GET /api/auth/session
export const session = (req, res) => {
  const session = req.session;
  return res.json({ user: session });
};

// Change password for employee and admin
// POST /api/auth/change-password
export const changePassword = async (req, res) => {
  try {
    const session = req.session;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Both passwords are required" });
    }
    const user = await User.findById(session.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid)
      return res.status(400).json({ error: "Current password is incorrect" });
    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(session.userId, { password: hashed });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: "Failed to change password" });
  }
};

// Employee self-registration
// POST /api/auth/register-employee
export const registerEmployee = async (req, res) => {
  try {
    const parseResult = registerEmployeeSchema.safeParse(req.body);
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
      password,
      department,
      position,
      joinDate,
      bio,
      profile_img,
    } = parseResult.data;

    const token = req.body.token;
    if (!token) {
      return res.status(400).json({
        error: "A valid registration invitation link is required to register.",
      });
    }

    const invite = await RegistrationInvite.findOne({ token, isActive: true });
    if (!invite) {
      return res.status(400).json({
        error: "This invitation link is invalid or has been deactivated.",
      });
    }

    const now = new Date();
    if (now > new Date(invite.expiresAt)) {
      return res.status(410).json({
        error:
          "This invitation link has expired. Please contact your company administrator.",
      });
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      return res.status(410).json({
        error:
          "This invitation link has reached its maximum registration limit.",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({
        error:
          "An account with this email address already exists. Please log in instead.",
      });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: normalizedEmail,
      password: hashed,
      role: invite.role || UserRole.EMPLOYEE,
      isApproved: false, // Must be approved by admin!
    });

    const employee = await Employee.create({
      userId: user._id,
      firstName,
      lastName,
      email: normalizedEmail,
      phone,
      position: position || "Team Member",
      department: invite.department || department,
      joinDate: joinDate ? new Date(joinDate) : new Date(),
      bio: bio || "",
      profile_img: profile_img || "",
      shiftHours: 8,
      basicSalary: 0,
      allowances: 0,
      deductions: 0,
      employmentStatus: EmploymentStatus.ACTIVE,
      approvalStatus: ApprovalStatus.PENDING, // Pending admin approval!
      inviteId: invite._id,
    });

    // Record submission into RegistrationInvite
    invite.submissions.push({
      employeeId: employee._id,
      userId: user._id,
      submittedAt: new Date(),
      approvalStatus: ApprovalStatus.PENDING,
    });
    invite.usedCount = (invite.usedCount || 0) + 1;
    await invite.save();

    // Send confirmation email to applicant that registration is pending review
    try {
      await sendEmail({
        to: normalizedEmail,
        subject:
          "Welcome to E Building HRMS - Registration Pending Approval",
        body: getRegistrationPendingApprovalEmail({
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: normalizedEmail,
          position: employee.position,
        }),
      });
    } catch (mailErr) {
      console.error(
        "Failed to send registration pending email:",
        mailErr.message,
      );
    }

    return res.status(201).json({
      success: true,
      message:
        "Registration submitted successfully! Your account is pending administrator approval.",
      pendingApproval: true,
      employee: {
        id: employee._id,
        name: `${employee.firstName} ${employee.lastName}`,
        email: employee.email,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: "Email already registered" });
    }
    console.error("Registration error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to complete registration" });
  }
};
