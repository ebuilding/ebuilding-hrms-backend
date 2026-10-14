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
