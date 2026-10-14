import crypto from "crypto";
import bcrypt from "bcrypt";
import RegistrationInvite from "../models/RegistrationInvite.js";
import Employee from "../models/Employee.js";
import User from "../models/User.js";
import sendEmail from "../config/nodemailer.js";
import {
  getApprovalConfirmedEmail,
  getRegistrationCorrectionEmail,
  getRegistrationPendingApprovalEmail,
} from "../utils/emailTemplates.js";
import {
  ApprovalStatus,
  EmploymentStatus,
  UserRole,
} from "../constants/enums.js";

// Create a new Registration Invite link
// POST /api/invites
export const createInvite = async (req, res) => {
  try {
    const {
      label,
      expiresInHours = 168, // Default 7 days (7 * 24 = 168)
      role = UserRole.EMPLOYEE,
      department = null,
      maxUses = null,
    } = req.body;

    const token = `inv_${crypto.randomBytes(16).toString("hex")}`;
    const hours = Number(expiresInHours) || 168;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);

    const invite = await RegistrationInvite.create({
      token,
      label: label ? label.trim() : "",
      role: role || UserRole.EMPLOYEE,
      department: department || null,
      createdBy: req.session.userId,
      expiresAt,
      maxUses: maxUses ? Number(maxUses) : null,
      isActive: true,
    });

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const inviteUrl = `${frontendUrl}/register?token=${token}`;

    return res.status(201).json({
      success: true,
      data: {
        ...invite.toObject(),
        inviteUrl,
      },
    });
  } catch (error) {
    console.error("Create invite error:", error);
    return res.status(500).json({ error: "Failed to generate invitation link" });
  }
};

// Get all Registration Invites with submissions & approval details
// GET /api/invites
export const getInvites = async (req, res) => {
  try {
    const invites = await RegistrationInvite.find()
      .populate("createdBy", "email role")
      .populate("department", "name")
      .populate({
        path: "submissions.employeeId",
        select:
          "firstName lastName email phone position profile_img department joinDate bio rejectionReason correctionToken correctionExpiresAt createdAt",
        populate: { path: "department", select: "name" },
      })
      .populate("submissions.approvedBy", "email")
      .sort({ createdAt: -1 })
      .lean();

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");
    const now = new Date();

    const result = invites.map((inv) => {
      const isExpired = now > new Date(inv.expiresAt);
      const isLimitReached = inv.maxUses ? inv.usedCount >= inv.maxUses : false;
      const isRevoked = !inv.isActive;
      const canRegister = inv.isActive && !isExpired && !isLimitReached;

      const submissions = (inv.submissions || []).map((sub) => {
        const emp = sub.employeeId;
        const rejectionReason =
          sub.rejectionReason || emp?.rejectionReason || "";
        const correctionToken = emp?.correctionToken || null;
        const correctionUrl = correctionToken
          ? `${frontendUrl}/register?correctionToken=${correctionToken}`
          : null;

        return {
          ...sub,
          candidateName: emp
            ? `${emp.firstName} ${emp.lastName}`
            : "Unknown",
          candidateEmail: emp?.email || "",
          candidatePhone: emp?.phone || "",
          candidatePosition: emp?.position || "",
          candidateDepartment: emp?.department?.name || "Unassigned",
          candidateProfileImg: emp?.profile_img || "",
          candidateJoinDate: emp?.joinDate || null,
          candidateBio: emp?.bio || "",
          approvedByName: sub.approvedBy?.email || null,
          rejectionReason,
          correctionToken,
          correctionUrl,
        };
      });

      const pendingCount = submissions.filter(
        (s) => s.approvalStatus === ApprovalStatus.PENDING,
      ).length;
      const approvedCount = submissions.filter(
        (s) => s.approvalStatus === ApprovalStatus.APPROVED,
      ).length;
      const revokedCount = submissions.filter(
        (s) => s.approvalStatus === ApprovalStatus.REVOKED,
      ).length;

      return {
        ...inv,
        id: inv._id.toString(),
        inviteUrl: `${frontendUrl}/register?token=${inv.token}`,
        isExpired,
        isLimitReached,
        isRevoked,
        canRegister,
        submissions,
        totalSubmissions: submissions.length,
        pendingCount,
        approvedCount,
        revokedCount,
      };
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("Get invites error:", error);
    return res.status(500).json({ error: "Failed to fetch invitation links" });
  }
};

// Delete an invitation link
// DELETE /api/invites/:id
export const deleteInvite = async (req, res) => {
  try {
    const { id } = req.params;
    const invite = await RegistrationInvite.findByIdAndDelete(id);

    if (!invite) {
      return res.status(404).json({ error: "Invitation link not found" });
    }

    return res.json({
      success: true,
      message: "Invitation link deleted successfully",
    });
  } catch (error) {
    console.error("Delete invite error:", error);
    return res.status(500).json({ error: "Failed to delete invitation link" });
  }
};

// Validate token on client visit
// GET /api/invites/validate/:token
export const validateInvite = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res
        .status(400)
        .json({ valid: false, error: "Invitation token is required" });
    }

    // Defensive fallback: If a correction token is accidentally queried via this route
    if (token.startsWith("corr_")) {
      return validateCorrectionToken(req, res);
    }

    const invite = await RegistrationInvite.findOne({ token })
      .populate("department", "name")
      .lean();

    if (!invite) {
      return res.status(404).json({
        valid: false,
        error: "This invitation link does not exist or has been removed.",
      });
    }

    if (!invite.isActive) {
      return res.status(410).json({
        valid: false,
        error: "This invitation link has been revoked by an administrator.",
      });
    }

    const now = new Date();
    if (now > new Date(invite.expiresAt)) {
      return res.status(410).json({
        valid: false,
        error: "This invitation link has expired. Please request a new link from your administrator.",
      });
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      return res.status(410).json({
        valid: false,
        error: "This invitation link has reached its maximum registration limit.",
      });
    }

    return res.json({
      valid: true,
      data: {
        role: invite.role,
        label: invite.label,
        department: invite.department ? invite.department._id : null,
        departmentName: invite.department?.name || null,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    console.error("Validate invite error:", error);
    return res.status(500).json({ valid: false, error: "Failed to validate invite" });
  }
};

// Approve an employee self-registration submission
// PATCH /api/invites/:inviteId/submissions/:employeeId/approve
export const approveSubmission = async (req, res) => {
  try {
    const { inviteId, employeeId } = req.params;
    const adminId = req.session.userId;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: "Employee record not found" });
    }

    // Update Employee record
    employee.approvalStatus = ApprovalStatus.APPROVED;
    employee.approvedBy = adminId;
    employee.approvedAt = new Date();
    await employee.save();

    // Update User record to active approval
    await User.findByIdAndUpdate(employee.userId, { isApproved: true });

    // Update invite submission record
    const invite = await RegistrationInvite.findById(inviteId);
    if (invite) {
      const sub = invite.submissions.find(
        (s) => s.employeeId?.toString() === employeeId.toString(),
      );
      if (sub) {
        sub.approvalStatus = ApprovalStatus.APPROVED;
        sub.approvedBy = adminId;
        sub.approvedAt = new Date();
        await invite.save();
      }
    }

    // Send Approval Email to candidate
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    try {
      await sendEmail({
        to: employee.email,
        subject: "Welcome to E Building HRMS - Account Approved",
        body: getApprovalConfirmedEmail({
          firstName: employee.firstName,
          lastName: employee.lastName,
          position: employee.position,
          email: employee.email,
          loginUrl: `${frontendUrl}/login`,
        }),
      });
    } catch (emailErr) {
      console.error("Failed to send approval confirmation email:", emailErr);
    }

    // Get admin details for immediate response
    const adminUser = await User.findById(adminId).select("email").lean();

    return res.json({
      success: true,
      message: `${employee.firstName} ${employee.lastName} has been approved and added to active employees.`,
      data: {
        employeeId: employee._id,
        approvalStatus: ApprovalStatus.APPROVED,
        approvedBy: adminId,
        approvedByName: adminUser?.email || "Admin",
        approvedAt: employee.approvedAt,
      },
    });
  } catch (error) {
    console.error("Approve submission error:", error);
    return res.status(500).json({ error: "Failed to approve employee" });
  }
};

// Reject an employee self-registration submission with reason & correction link
// PATCH /api/invites/:inviteId/submissions/:employeeId/reject
export const rejectSubmission = async (req, res) => {
  try {
    const { inviteId, employeeId } = req.params;
    const { reason = "" } = req.body;
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      return res.status(400).json({
        error: "Please provide a correction reason explaining what the candidate needs to fix.",
      });
    }

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: "Employee record not found" });
    }

    // Generate secure crypto correction token (valid for 7 days)
    const correctionToken = `corr_${crypto.randomBytes(24).toString("hex")}`;
    const correctionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Update Employee record
    employee.approvalStatus = ApprovalStatus.REJECTED;
    employee.rejectionReason = trimmedReason;
    employee.correctionToken = correctionToken;
    employee.correctionExpiresAt = correctionExpiresAt;
    await employee.save();

    // Disable User login
    await User.findByIdAndUpdate(employee.userId, { isApproved: false });

    // Update invite submission record
    const invite = await RegistrationInvite.findById(inviteId);
    if (invite) {
      const sub = invite.submissions.find(
        (s) => s.employeeId?.toString() === employeeId.toString(),
      );
      if (sub) {
        sub.approvalStatus = ApprovalStatus.REJECTED;
        sub.rejectionReason = trimmedReason;
        await invite.save();
      }
    }

    // Send Correction Email to candidate with secure crypto link
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const correctionUrl = `${frontendUrl}/register?correctionToken=${correctionToken}`;
    try {
      await sendEmail({
        to: employee.email,
        subject: "E Building HRMS - Action Required: Update Your Registration",
        body: getRegistrationCorrectionEmail({
          firstName: employee.firstName,
          lastName: employee.lastName,
          reason: trimmedReason,
          correctionUrl,
          expiresHours: 168,
        }),
      });
    } catch (emailErr) {
      console.error("Failed to send correction email to applicant:", emailErr);
    }

    return res.json({
      success: true,
      message: `Correction request sent to ${employee.firstName} ${employee.lastName}. They will receive an email with a secure link to update their details.`,
      data: {
        employeeId: employee._id,
        approvalStatus: ApprovalStatus.REJECTED,
        rejectionReason: trimmedReason,
      },
    });
  } catch (error) {
    console.error("Reject submission error:", error);
    return res.status(500).json({ error: "Failed to reject employee submission" });
  }
};

// Validate correction token when candidate visits /register?correctionToken=...
// GET /api/invites/correction/validate/:token
export const validateCorrectionToken = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ valid: false, error: "Correction token is required" });
    }

    const employee = await Employee.findOne({ correctionToken: token })
      .populate("department", "name")
      .lean();

    if (!employee) {
      return res.status(404).json({
        valid: false,
        error: "This correction link is invalid or has already been used.",
      });
    }

    if (employee.approvalStatus !== ApprovalStatus.REJECTED) {
      return res.status(400).json({
        valid: false,
        error: "This application has already been resubmitted and is awaiting administrator review.",
      });
    }

    const now = new Date();
    if (employee.correctionExpiresAt && now > new Date(employee.correctionExpiresAt)) {
      return res.status(410).json({
        valid: false,
        error: "This correction link has expired. Please contact your company administrator for assistance.",
      });
    }

    const candidateData = {
      employeeId: employee._id,
      firstName: employee.firstName || "",
      lastName: employee.lastName || "",
      email: employee.email || "",
      phone: employee.phone || "",
      department:
        employee.department?._id?.toString() ||
        employee.department?.toString() ||
        "",
      departmentName: employee.department?.name || "",
      position: employee.position || "",
      joinDate: employee.joinDate || "",
      bio: employee.bio || "",
      profile_img: employee.profile_img || "",
      rejectionReason: employee.rejectionReason || "",
      expiresAt: employee.correctionExpiresAt,
    };

    return res.json({
      valid: true,
      mode: "correction",
      rejectionReason: employee.rejectionReason || "",
      candidate: candidateData,
      data: candidateData,
    });
  } catch (error) {
    console.error("Validate correction token error:", error);
    return res.status(500).json({ valid: false, error: "Failed to validate correction link" });
  }
};

// Resubmit updated candidate application
// PUT /api/invites/correction/resubmit/:token
export const resubmitCorrection = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ error: "Correction token is required" });
    }

    const employee = await Employee.findOne({ correctionToken: token });
    if (!employee) {
      return res.status(404).json({
        error: "This correction link is invalid or has already been used.",
      });
    }

    if (employee.approvalStatus !== ApprovalStatus.REJECTED) {
      return res.status(400).json({
        error: "This application has already been resubmitted and is awaiting administrator review.",
      });
    }

    const now = new Date();
    if (employee.correctionExpiresAt && now > new Date(employee.correctionExpiresAt)) {
      return res.status(410).json({
        error: "This correction link has expired. Please contact your company administrator for a new link.",
      });
    }

    const {
      firstName,
      lastName,
      phone,
      department,
      position,
      joinDate,
      bio,
      profile_img,
      password,
    } = req.body;

    if (!firstName || !lastName || !phone || !position) {
      return res.status(400).json({ error: "Please fill in all required fields." });
    }

    employee.firstName = firstName.trim();
    employee.lastName = lastName.trim();
    employee.phone = phone.trim();
    employee.position = position.trim();
    if (department) employee.department = department;
    if (joinDate) employee.joinDate = new Date(joinDate);
    if (bio !== undefined) employee.bio = bio.trim();
    if (profile_img !== undefined) employee.profile_img = profile_img;

    employee.approvalStatus = ApprovalStatus.PENDING;
    employee.rejectionReason = "";
    employee.correctionToken = null; // Clear token after successful resubmission to prevent reuse
    employee.correctionExpiresAt = null;
    await employee.save();

    // If candidate updated their password:
    if (password && password.trim().length >= 8) {
      const hashed = await bcrypt.hash(password.trim(), 10);
      await User.findByIdAndUpdate(employee.userId, { password: hashed, isApproved: false });
    }

    // Update invite submission record
    if (employee.inviteId) {
      const invite = await RegistrationInvite.findById(employee.inviteId);
      if (invite) {
        const sub = invite.submissions.find(
          (s) => s.employeeId?.toString() === employee._id.toString(),
        );
        if (sub) {
          sub.approvalStatus = ApprovalStatus.PENDING;
          sub.rejectionReason = "";
          sub.submittedAt = new Date();
          await invite.save();
        }
      }
    }

    // Send confirmation email
    try {
      await sendEmail({
        to: employee.email,
        subject: "Welcome to E Building HRMS - Registration Pending Approval",
        body: getRegistrationPendingApprovalEmail({
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          position: employee.position,
        }),
      });
    } catch (mailErr) {
      console.error("Failed to send resubmission confirmation email:", mailErr.message);
    }

    return res.json({
      success: true,
      message: "Your application has been updated and resubmitted successfully! It is now pending administrator review.",
      data: {
        employeeId: employee._id,
        approvalStatus: ApprovalStatus.PENDING,
      },
    });
  } catch (error) {
    console.error("Resubmit correction error:", error);
    return res.status(500).json({ error: "Failed to resubmit application" });
  }
};

// Toggle an invitation link's active / revoked state
// PATCH /api/invites/:id/toggle-status
export const toggleInviteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const invite = await RegistrationInvite.findById(id);

    if (!invite) {
      return res.status(404).json({ error: "Invitation link not found" });
    }

    invite.isActive = !invite.isActive;
    await invite.save();

    return res.json({
      success: true,
      message: invite.isActive
        ? "Invitation link has been re-activated successfully."
        : "Invitation link has been revoked successfully.",
      data: {
        id: invite._id,
        isActive: invite.isActive,
      },
    });
  } catch (error) {
    console.error("Toggle invite status error:", error);
    return res
      .status(500)
      .json({ error: "Failed to update invitation link status" });
  }
};

// Revoke an already approved employee self-registration submission
// PATCH /api/invites/:inviteId/submissions/:employeeId/revoke
export const revokeSubmission = async (req, res) => {
  try {
    const { inviteId, employeeId } = req.params;
    const { reason = "Approval revoked by administrator" } = req.body;
    const adminId = req.session.userId;

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: "Employee record not found" });
    }

    // Update Employee record to REVOKED & INACTIVE
    employee.approvalStatus = ApprovalStatus.REVOKED;
    employee.employmentStatus = EmploymentStatus.INACTIVE;
    employee.rejectionReason = reason;
    await employee.save();

    // Disable User account login
    await User.findByIdAndUpdate(employee.userId, { isApproved: false });

    // Update invite submission record
    const invite = await RegistrationInvite.findById(inviteId);
    if (invite) {
      const sub = invite.submissions.find(
        (s) => s.employeeId?.toString() === employeeId.toString(),
      );
      if (sub) {
        sub.approvalStatus = ApprovalStatus.REVOKED;
        sub.rejectionReason = reason;
        await invite.save();
      }
    }

    return res.json({
      success: true,
      message: `${employee.firstName} ${employee.lastName}'s approval has been revoked and portal access disabled.`,
      data: {
        employeeId: employee._id,
        approvalStatus: ApprovalStatus.REVOKED,
      },
    });
  } catch (error) {
    console.error("Revoke submission error:", error);
    return res
      .status(500)
      .json({ error: "Failed to revoke employee approval" });
  }
};
