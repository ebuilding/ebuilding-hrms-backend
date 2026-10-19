export const getEmailTemplate = (
  content,
  title = "E Building HRMS Notification",
) => `
<div style="
  background:#f4f7fb;
  padding:32px 16px;
  font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
">

  <div style="
    max-width:640px;
    margin:auto;
    background:#ffffff;
    border:1px solid #e5e7eb;
    border-radius:20px;
    overflow:hidden;
  ">

    <!-- Header -->
    <div style="
      padding:24px 32px;
      border-bottom:1px solid #eef2f7;
      background:#ffffff;
    ">

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="left">
            <div style="
              font-size:20px;
              font-weight:700;
              color:#111827;
              letter-spacing:-0.02em;
            ">
              E Building HRMS
            </div>

            <div style="
              margin-top:4px;
              font-size:13px;
              color:#6b7280;
            ">
              Workforce Management System
            </div>
          </td>

          <td align="right">
            <div style="
              background:#fdf2f8;
              color:#811c50;
              font-size:12px;
              font-weight:600;
              padding:6px 12px;
              border-radius:999px;
              display:inline-block;
            ">
              ${title}
            </div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Body -->
    <div style="
      padding:36px 32px;
      color:#374151;
      font-size:15px;
      line-height:1.8;
    ">

      ${content}

    </div>

    <!-- Footer -->
    <div style="
      padding:20px 32px;
      border-top:1px solid #eef2f7;
      background:#fcfcfd;
    ">

      <div style="
        font-size:13px;
        color:#94a3b8;
        line-height:1.7;
      ">
        This is an automated email from E Building HRMS.<br>
        Please do not reply directly to this message.
      </div>

      <div style="
        margin-top:12px;
        font-size:12px;
        color:#c0c7d2;
      ">
        © ${new Date().getFullYear()} E Building HRMS. All rights reserved.
      </div>

    </div>
  </div>
</div>
`;

export const getWelcomeCredentialsEmail = ({
  firstName,
  lastName,
  email,
  password,
  loginUrl,
  position,
}) => {
  const content = `
<h2 style="
  margin:0 0 16px;
  font-size:24px;
  line-height:1.3;
  color:#111827;
  font-weight:700;
">
  Welcome to E Building HRMS, ${firstName}! 👋
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  An employee account has been created for you on the <strong>E Building HRMS</strong> portal.
  Below are your initial login credentials to access your dashboard, record attendance, and submit requests.
</p>

<div style="
  background:#f8fafc;
  border:1px solid #e2e8f0;
  border-radius:16px;
  padding:24px;
  margin:24px 0;
">
  <div style="font-size:13px; font-weight:700; color:#64748b; margin-bottom:14px; text-transform:uppercase; letter-spacing:0.05em;">
    Account Login Details
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    <tr>
      <td style="padding:8px 0; color:#64748b;">Role / Position:</td>
      <td align="right" style="padding:8px 0; color:#111827; font-weight:600;">${position || "Employee"}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#64748b; border-top:1px solid #edf2f7;">Login Email:</td>
      <td align="right" style="padding:8px 0; color:#111827; font-weight:600;">${email}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#64748b; border-top:1px solid #edf2f7;">Password:</td>
      <td align="right" style="padding:8px 0; color:#811c50; font-weight:700; font-family:monospace; font-size:15px;">${password}</td>
    </tr>
  </table>
</div>

<div style="
  background:#eff6ff;
  border:1px solid #bfdbfe;
  color:#1e40af;
  padding:14px 18px;
  border-radius:12px;
  margin:20px 0 28px;
  font-size:13px;
  line-height:1.6;
">
  🔒 <strong>Security Tip:</strong> For security reasons, please change your password after logging in for the first time via your Profile settings.
</div>

<div style="text-align:center; margin-top:28px;">
  <a href="${loginUrl}"
    style="
      display:inline-block;
      background:#811c50;
      color:#ffffff;
      text-decoration:none;
      padding:14px 28px;
      border-radius:12px;
      font-size:15px;
      font-weight:600;
      letter-spacing:0.01em;
    ">
    Login to Your Account →
  </a>
</div>
`;

  return getEmailTemplate(content, "Account Credentials");
};

export const getRegistrationPendingApprovalEmail = ({
  firstName,
  lastName,
  email,
  position,
}) => {
  const content = `
<h2 style="
  margin:0 0 16px;
  font-size:24px;
  line-height:1.3;
  color:#111827;
  font-weight:700;
">
  Registration Received, ${firstName}! ⏳
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  Thank you for registering your profile on <strong>E Building HRMS</strong>.
  Your submission has been safely recorded and is <strong>pending administrator approval</strong>.
</p>

<div style="
  background:#fffbeb;
  border:1px solid #fde68a;
  border-radius:16px;
  padding:20px;
  margin:24px 0;
">
  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    <tr>
      <td style="padding:8px 0; color:#92400e;">Applicant:</td>
      <td align="right" style="padding:8px 0; color:#78350f; font-weight:600;">${firstName} ${lastName}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#92400e; border-top:1px solid #fef3c7;">Designation:</td>
      <td align="right" style="padding:8px 0; color:#78350f; font-weight:600;">${position || "Employee"}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#92400e; border-top:1px solid #fef3c7;">Email:</td>
      <td align="right" style="padding:8px 0; color:#78350f; font-weight:600;">${email}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#92400e; border-top:1px solid #fef3c7;">Status:</td>
      <td align="right" style="padding:8px 0; color:#d97706; font-weight:700;">Pending Admin Review</td>
    </tr>
  </table>
</div>

<p style="color:#64748b; font-size:14px; line-height:1.7;">
  Once an administrator reviews and approves your account, you will receive another email notifying you that your portal access has been activated.
</p>
`;

  return getEmailTemplate(content, "Registration Pending Approval");
};

export const getApprovalConfirmedEmail = ({
  firstName,
  lastName,
  email,
  position,
  loginUrl,
}) => {
  const content = `
<h2 style="
  margin:0 0 16px;
  font-size:24px;
  line-height:1.3;
  color:#111827;
  font-weight:700;
">
  Account Approved, ${firstName}! 🎉
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  Great news! Your employee account on <strong>E Building HRMS</strong> has been officially approved by the company administrator.
  You can now log in using the password you set during registration.
</p>

<div style="
  background:#f0fdf4;
  border:1px solid #bbf7d0;
  border-radius:16px;
  padding:20px;
  margin:24px 0;
">
  <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    <tr>
      <td style="padding:8px 0; color:#166534;">Employee Name:</td>
      <td align="right" style="padding:8px 0; color:#14532d; font-weight:600;">${firstName} ${lastName}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#166534; border-top:1px solid #dcfce7;">Designation:</td>
      <td align="right" style="padding:8px 0; color:#14532d; font-weight:600;">${position || "Employee"}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#166534; border-top:1px solid #dcfce7;">Login Email:</td>
      <td align="right" style="padding:8px 0; color:#14532d; font-weight:600;">${email}</td>
    </tr>
    <tr>
      <td style="padding:8px 0; color:#166534; border-top:1px solid #dcfce7;">Status:</td>
      <td align="right" style="padding:8px 0; color:#16a34a; font-weight:700;">Active &amp; Approved</td>
    </tr>
  </table>
</div>

<div style="text-align:center; margin-top:28px;">
  <a href="${loginUrl}"
    style="
      display:inline-block;
      background:#811c50;
      color:#ffffff;
      text-decoration:none;
      padding:14px 28px;
      border-radius:12px;
      font-size:15px;
      font-weight:600;
    ">
    Log In to Your Portal →
  </a>
</div>
`;

  return getEmailTemplate(content, "Registration Approved");
};

export const getRegistrationCorrectionEmail = ({
  firstName,
  lastName,
  reason,
  correctionUrl,
  expiresHours = 168,
}) => {
  const content = `
<h2 style="
  margin:0 0 16px;
  font-size:24px;
  line-height:1.3;
  color:#111827;
  font-weight:700;
">
  Action Required: Update Your Application, ${firstName}
</h2>

<p style="
  margin:0 0 20px;
  color:#4b5563;
  font-size:15px;
  line-height:1.8;
">
  The company administrator has reviewed your self-registration for <strong>E Building HRMS</strong> and requested corrections before your account can be approved.
</p>

<div style="
  background:#fff7ed;
  border:1px solid #fed7aa;
  border-left:4px solid #ea580c;
  border-radius:12px;
  padding:18px 20px;
  margin:24px 0;
">
  <div style="font-size:13px; font-weight:700; color:#9a3412; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">
    Reason / Changes Requested by Administrator:
  </div>
  <div style="font-size:15px; color:#7c2d12; line-height:1.6; font-weight:500;">
    "${reason}"
  </div>
</div>

<p style="color:#4b5563; font-size:14px; line-height:1.7;">
  Please click the button below to review your pre-filled information, make the necessary corrections, and resubmit your application.
</p>

<div style="text-align:center; margin:32px 0;">
  <a href="${correctionUrl}"
    style="
      display:inline-block;
      background:#811c50;
      color:#ffffff;
      text-decoration:none;
      padding:14px 32px;
      border-radius:12px;
      font-size:15px;
      font-weight:600;
      box-shadow:0 4px 12px rgba(129, 28, 80, 0.25);
    ">
    Review &amp; Correct Application →
  </a>
</div>

<p style="color:#94a3b8; font-size:12px; line-height:1.6; text-align:center;">
  This secure correction link will remain valid for ${expiresHours} hours (${Math.round(expiresHours / 24)} days).
  If you believe this message was sent in error, please contact your administrator.
</p>
`;

  return getEmailTemplate(content, "Changes Requested on Registration");
};

export const getPasswordResetEmail = ({
  name = "Team Member",
  resetLink,
  expireMinutes = 5,
}) => {
  const content = `
<div style="text-align:center; margin-bottom:24px;">
  <div style="
    display:inline-block;
    width:56px;
    height:56px;
    line-height:56px;
    background:#fdf2f8;
    color:#811c50;
    border-radius:50%;
    font-size:24px;
    margin-bottom:16px;
  ">
    🔑
  </div>
  <h2 style="color:#0f172a; margin:0 0 8px 0; font-size:22px; font-weight:700;">Password Reset Request</h2>
  <p style="color:#64748b; font-size:14px; margin:0;">Follow the link below to set a new password for your account.</p>
</div>

<p style="color:#334155; font-size:14px; line-height:1.6;">
  Hello <strong>${name}</strong>,
</p>

<p style="color:#334155; font-size:14px; line-height:1.6;">
  We received a request to reset the password associated with your E Building HRMS account. To proceed, click the button below:
</p>

<div style="text-align:center; margin:32px 0;">
  <a href="${resetLink}"
    style="
      display:inline-block;
      background:#811c50;
      color:#ffffff;
      text-decoration:none;
      padding:14px 32px;
      border-radius:12px;
      font-size:15px;
      font-weight:600;
      box-shadow:0 4px 12px rgba(129, 28, 80, 0.25);
    ">
    Reset My Password →
  </a>
</div>

<div style="background:#fffbeb; border:1px solid #fef3c7; border-radius:12px; padding:16px; margin:24px 0;">
  <p style="color:#92400e; font-size:13px; font-weight:600; margin:0 0 4px 0;">
    ⏰ Important Security Notice
  </p>
  <p style="color:#b45309; font-size:12px; margin:0; line-height:1.5;">
    This link is single-use and will automatically <strong>expire in ${expireMinutes} minutes</strong>. If you did not request a password reset, you can safely ignore this email — your account remains completely secure.
  </p>
</div>

<p style="color:#94a3b8; font-size:12px; line-height:1.6; word-break:break-all;">
  If the button above does not work, copy and paste this link into your browser:<br/>
  <a href="${resetLink}" style="color:#811c50;">${resetLink}</a>
</p>
`;

  return getEmailTemplate(content, "Password Reset Request");
};

export const getPasswordResetSuccessEmail = ({ name = "Team Member" }) => {
  const content = `
<div style="text-align:center; margin-bottom:24px;">
  <div style="
    display:inline-block;
    width:56px;
    height:56px;
    line-height:56px;
    background:#ecfdf5;
    color:#059669;
    border-radius:50%;
    font-size:24px;
    margin-bottom:16px;
  ">
    ✅
  </div>
  <h2 style="color:#0f172a; margin:0 0 8px 0; font-size:22px; font-weight:700;">Password Changed Successfully</h2>
  <p style="color:#64748b; font-size:14px; margin:0;">Your account password has been updated.</p>
</div>

<p style="color:#334155; font-size:14px; line-height:1.6;">
  Hello <strong>${name}</strong>,
</p>

<p style="color:#334155; font-size:14px; line-height:1.6;">
  This is a confirmation that the password for your E Building HRMS account has been successfully changed. You can now use your new password to sign in.
</p>

<div style="background:#fef2f2; border:1px solid #fee2e2; border-radius:12px; padding:16px; margin:24px 0;">
  <p style="color:#991b1b; font-size:13px; font-weight:600; margin:0 0 4px 0;">
    🛡️ Did you not make this change?
  </p>
  <p style="color:#b91c1c; font-size:12px; margin:0; line-height:1.5;">
    If you did not perform this password change, please contact your company administrator immediately to protect your account.
  </p>
</div>
`;

  return getEmailTemplate(content, "Password Changed");
};

export const getBirthdayWishEmail = ({ name = "Team Member", companyName = "E Building HRMS", customMessage = "" }) => {
  const content = `
<div style="text-align:center; margin-bottom:28px;">
  <div style="
    display:inline-block;
    width:64px;
    height:64px;
    line-height:64px;
    background:#fdf2f8;
    color:#811c50;
    border-radius:50%;
    font-size:32px;
    margin-bottom:16px;
    border:2px solid #fbcfe8;
  ">
    🎂
  </div>
  <h2 style="color:#0f172a; margin:0 0 8px 0; font-size:24px; font-weight:800; letter-spacing:-0.02em;">Happy Birthday, ${name}! 🎉</h2>
  <p style="color:#811c50; font-size:15px; font-weight:600; margin:0;">Wishing you a truly wonderful day!</p>
</div>

<p style="color:#334155; font-size:15px; line-height:1.7; margin-bottom:16px;">
  Dear <strong>${name}</strong>,
</p>

<p style="color:#334155; font-size:15px; line-height:1.7;">
  On behalf of everyone at <strong>${companyName}</strong>, we wish you a very Happy Birthday! 🌟
</p>

${customMessage ? `
<div style="background:#fdf2f8; border-left:4px solid #811c50; border-radius:0 12px 12px 0; padding:16px; margin:20px 0;">
  <p style="color:#811c50; font-size:14px; font-weight:600; margin:0 0 4px 0;">A special note from your team:</p>
  <p style="color:#334155; font-size:14px; margin:0; line-height:1.6; font-style:italic;">"${customMessage}"</p>
</div>
` : `
<p style="color:#334155; font-size:15px; line-height:1.7;">
  Thank you for bringing your energy, talent, and passion to our team every single day. We hope this year brings you tremendous joy, good health, personal fulfillment, and continued success.
</p>
`}

<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:16px; padding:20px; text-align:center; margin:28px 0;">
  <p style="color:#64748b; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; font-weight:700; margin:0 0 4px 0;">Celebration Milestone</p>
  <p style="color:#0f172a; font-size:18px; font-weight:800; margin:0;">Have a fantastic celebration! 🎈🍰</p>
</div>

<p style="color:#64748b; font-size:14px; margin-top:24px;">
  Warmest regards,<br />
  <strong>${companyName} Team</strong>
</p>
`;

  return getEmailTemplate(content, "Birthday Wishes");
};

export const getWorkAnniversaryWishEmail = ({ name = "Team Member", years = 1, companyName = "E Building HRMS", customMessage = "" }) => {
  const content = `
<div style="text-align:center; margin-bottom:28px;">
  <div style="
    display:inline-block;
    width:64px;
    height:64px;
    line-height:64px;
    background:#ecfdf5;
    color:#059669;
    border-radius:50%;
    font-size:32px;
    margin-bottom:16px;
    border:2px solid #a7f3d0;
  ">
    🎖️
  </div>
  <h2 style="color:#0f172a; margin:0 0 8px 0; font-size:24px; font-weight:800; letter-spacing:-0.02em;">Happy Work Anniversary, ${name}! 🎊</h2>
  <div style="display:inline-block; background:#059669; color:#ffffff; font-size:13px; font-weight:700; padding:6px 16px; border-radius:999px; margin-top:4px;">
    Celebrating ${years} ${years === 1 ? "Year" : "Years"} with Us
  </div>
</div>

<p style="color:#334155; font-size:15px; line-height:1.7; margin-bottom:16px;">
  Dear <strong>${name}</strong>,
</p>

<p style="color:#334155; font-size:15px; line-height:1.7;">
  Today marks a very special milestone — congratulations on completing <strong>${years} ${years === 1 ? "year" : "years"}</strong> at <strong>${companyName}</strong>! 🚀
</p>

${customMessage ? `
<div style="background:#ecfdf5; border-left:4px solid #059669; border-radius:0 12px 12px 0; padding:16px; margin:20px 0;">
  <p style="color:#065f46; font-size:14px; font-weight:600; margin:0 0 4px 0;">A note of appreciation:</p>
  <p style="color:#334155; font-size:14px; margin:0; line-height:1.6; font-style:italic;">"${customMessage}"</p>
</div>
` : `
<p style="color:#334155; font-size:15px; line-height:1.7;">
  Your hard work, commitment, and valuable contributions continue to make an enormous difference. We are incredibly proud and grateful to have you on our team and look forward to achieving many more milestones together.
</p>
`}

<div style="background:#f8fafc; border:1px dashed #cbd5e1; border-radius:16px; padding:20px; text-align:center; margin:28px 0;">
  <p style="color:#64748b; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; font-weight:700; margin:0 0 4px 0;">Company Milestone</p>
  <p style="color:#0f172a; font-size:18px; font-weight:800; margin:0;">Thank you for your loyalty & dedication! 👏</p>
</div>

<p style="color:#64748b; font-size:14px; margin-top:24px;">
  Warmest congratulations,<br />
  <strong>${companyName} Management</strong>
</p>
`;

  return getEmailTemplate(content, "Work Anniversary Wishes");
};

