import crypto from "crypto";
import User from "../models/User.js";
import Employee from "../models/Employee.js";
import PasswordResetToken from "../models/PasswordResetToken.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import sendEmail from "../config/nodemailer.js";
import {
  getRegistrationPendingApprovalEmail,
  getPasswordResetEmail,
  getPasswordResetSuccessEmail,
} from "../utils/emailTemplates.js";
import { registerEmployeeSchema } from "../validators/employeeValidator.js";
import RegistrationInvite from "../models/RegistrationInvite.js";
import {
  ApprovalStatus,
  EmploymentStatus,
  UserRole,
  PasswordResetReason,
  PasswordResetConfig,
} from "../constants/enums.js";
import { getAttendanceShiftConfig } from "../utils/shiftConfig.js";

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

    const shiftConfig = await getAttendanceShiftConfig();
    const defaultShiftHours = Number(shiftConfig?.shiftHours) || 9;

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
      shiftHours: defaultShiftHours,
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
        subject: "Welcome to E Building HRMS - Registration Pending Approval",
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

// Request password reset link (5-minute expiry, rate-limited, anti-spam)
// POST /api/auth/forgot-password
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res
        .status(400)
        .json({ error: "Please provide a valid email address." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Rate limiting & Anti-Spam protection per email
    const rateLimitWindowMs =
      PasswordResetConfig.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
    const windowStart = new Date(Date.now() - rateLimitWindowMs);
    const recentTokens = await PasswordResetToken.find({
      email: normalizedEmail,
      createdAt: { $gte: windowStart },
    }).sort({ createdAt: -1 });

    // Anti-spam: enforce cooldown between link requests for the same email
    if (recentTokens.length > 0) {
      const secondsSinceLast =
        (Date.now() - new Date(recentTokens[0].createdAt).getTime()) / 1000;
      if (secondsSinceLast < PasswordResetConfig.COOLDOWN_SECONDS) {
        const waitTime = Math.ceil(
          PasswordResetConfig.COOLDOWN_SECONDS - secondsSinceLast,
        );
        return res.status(429).json({
          error: `A reset link was recently sent. Please wait ${waitTime} seconds before requesting another.`,
          retryAfter: waitTime,
        });
      }
    }

    // Rate limit: max requests per window per email
    if (recentTokens.length >= PasswordResetConfig.MAX_REQUESTS_PER_WINDOW) {
      return res.status(429).json({
        error: `Too many password reset requests. Please try again after ${PasswordResetConfig.RATE_LIMIT_WINDOW_MINUTES} minutes.`,
      });
    }

    // 2. Check if user exists
    const user = await User.findOne({ email: normalizedEmail });

    // Anti-enumeration protection: return identical success message even if email not found
    if (!user) {
      return res.json({
        success: true,
        message:
          "If an account is associated with this email, a password reset link has been sent.",
      });
    }

    // 3. Invalidate any existing unused tokens for this user
    await PasswordResetToken.updateMany(
      { userId: user._id, used: false },
      { used: true },
    );

    // 4. Generate cryptographically secure token & SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(
      Date.now() + PasswordResetConfig.EXPIRY_MINUTES * 60 * 1000,
    );

    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = forwarded
      ? forwarded.split(",")[0].trim()
      : req.headers["x-real-ip"] || req.ip;

    await PasswordResetToken.create({
      userId: user._id,
      email: normalizedEmail,
      tokenHash,
      expiresAt,
      requestIp: clientIp,
    });

    // 5. Look up user/employee name for personalized email
    const employee = await Employee.findOne({ userId: user._id });
    const name = employee
      ? `${employee.firstName} ${employee.lastName}`
      : user.email.split("@")[0];

    // 6. Construct reset URL
    const frontendUrl = (
      process.env.FRONTEND_URL || "http://localhost:5173"
    ).replace(/\/+$/, "");
    const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

    // 7. Send email
    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Reset your E Building HRMS password",
        body: getPasswordResetEmail({
          name,
          resetLink,
          expireMinutes: PasswordResetConfig.EXPIRY_MINUTES,
        }),
      });
    } catch (mailErr) {
      console.error("Failed to send password reset email:", mailErr);
      return res.status(500).json({
        error:
          "Failed to send email. Please check your network or try again later.",
      });
    }

    return res.json({
      success: true,
      message:
        "If an account is associated with this email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res
      .status(500)
      .json({ error: "Failed to process password reset request." });
  }
};

// Verify if a reset token is valid and not expired
// GET /api/auth/verify-reset-token
export const verifyResetToken = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).json({
        valid: false,
        reason: PasswordResetReason.MISSING,
        error: "Password reset token is required.",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await PasswordResetToken.findOne({ tokenHash });

    if (!record || record.used) {
      return res.status(400).json({
        valid: false,
        reason: PasswordResetReason.INVALID,
        error: "This password reset link is invalid or has already been used.",
      });
    }

    if (new Date() > new Date(record.expiresAt)) {
      return res.status(410).json({
        valid: false,
        reason: PasswordResetReason.EXPIRED,
        error: `This password reset link has expired. Links are valid for ${PasswordResetConfig.EXPIRY_MINUTES} minutes only.`,
      });
    }

    return res.json({
      valid: true,
      email: record.email,
    });
  } catch (error) {
    console.error("Verify token error:", error);
    return res.status(500).json({
      valid: false,
      reason: PasswordResetReason.SERVER_ERROR,
      error: "Failed to verify reset token.",
    });
  }
};

// Set new password using token
// POST /api/auth/reset-password
export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== "string") {
      return res
        .status(400)
        .json({ error: "Password reset token is required." });
    }

    if (
      !newPassword ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        error:
          "Password must be at least 8 characters long and contain letters and numbers.",
      });
    }

    // Require at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      return res.status(400).json({
        error: "Password must contain both letters and numbers for security.",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const record = await PasswordResetToken.findOne({
      tokenHash,
      used: false,
    });

    if (!record) {
      return res.status(400).json({
        error: "This password reset link is invalid or has already been used.",
      });
    }

    if (new Date() > new Date(record.expiresAt)) {
      return res.status(410).json({
        error: `This password reset link has expired. Links are valid for ${PasswordResetConfig.EXPIRY_MINUTES} minutes only. Please request a new one.`,
      });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      return res.status(404).json({ error: "User account no longer exists." });
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    // Invalidate this token and all other tokens for this user
    record.used = true;
    record.usedAt = new Date();
    await record.save();

    await PasswordResetToken.updateMany(
      { userId: user._id, used: false },
      { used: true },
    );

    // Send confirmation email
    const employee = await Employee.findOne({ userId: user._id });
    const name = employee
      ? `${employee.firstName} ${employee.lastName}`
      : user.email.split("@")[0];

    try {
      await sendEmail({
        to: user.email,
        subject: "Your E Building HRMS password has been changed",
        body: getPasswordResetSuccessEmail({ name }),
      });
    } catch (mailErr) {
      console.error(
        "Failed to send password reset confirmation email:",
        mailErr.message,
      );
    }

    return res.json({
      success: true,
      message: "Your password has been successfully reset. You can now log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ error: "Failed to reset password." });
  }
};
