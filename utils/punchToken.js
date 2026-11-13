import crypto from "crypto";
import PunchNonce from "../models/PunchNonce.js";

const TOKEN_LIFETIME_MS = 45 * 1000; // 45 seconds expiration

const getPunchSecret = () => {
  return process.env.JWT_SECRET || "hrms-ephemeral-punch-secret-key-2026";
};

/**
 * Generates an ephemeral single-use punch token valid for 45 seconds.
 *
 * @param {string|mongoose.Types.ObjectId} userId - The user ID requesting the punch
 * @param {string} userAgent - Browser user-agent header
 * @returns {Promise<{ punchToken: string, expiresIn: number }>}
 */
export const generatePunchToken = async (userId, userAgent = "") => {
  const nonce = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
  const expTimestamp = expiresAt.getTime();

  // Create active nonce record in database
  await PunchNonce.create({
    nonce,
    userId,
    expiresAt,
    used: false,
    userAgent: (userAgent || "").slice(0, 250),
  });

  // Create HMAC-SHA256 signature
  const dataToSign = `${nonce}:${userId}:${expTimestamp}`;
  const signature = crypto
    .createHmac("sha256", getPunchSecret())
    .update(dataToSign)
    .digest("hex");

  const payload = {
    nonce,
    userId: userId.toString(),
    exp: expTimestamp,
    sig: signature,
  };

  const punchToken = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return {
    punchToken,
    expiresIn: 45,
  };
};

/**
 * Verifies and atomically consumes the ephemeral punch token.
 * Prevents replay attacks, cURL duplication, and token re-use.
 *
 * @param {string} tokenStr - Base64url encoded punch token
 * @param {string|mongoose.Types.ObjectId} expectedUserId - Authenticated user's ID
 * @param {object} req - Express request object for anti-script heuristic checks
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export const verifyAndConsumePunchToken = async (tokenStr, expectedUserId, req = null) => {
  if (!tokenStr || typeof tokenStr !== "string") {
    return {
      valid: false,
      error: "Punch authorization token is required. Please clock in directly from the application.",
    };
  }

  // Anti-script check: Reject explicit CLI clients (curl, python, postman)
  if (req && req.headers) {
    const ua = (req.headers["user-agent"] || "").toLowerCase();
    if (
      ua.includes("curl") ||
      ua.includes("python-requests") ||
      ua.includes("postmanruntime") ||
      ua.includes("httpie") ||
      ua.includes("aiohttp")
    ) {
      return {
        valid: false,
        error: "Automated CLI punch requests are prohibited. Please clock in from the application browser.",
      };
    }
  }

  let payload;
  try {
    const decoded = Buffer.from(tokenStr, "base64url").toString("utf-8");
    payload = JSON.parse(decoded);
  } catch {
    return {
      valid: false,
      error: "Malformed punch token. Please try clocking in again.",
    };
  }

  const { nonce, userId, exp, sig } = payload || {};
  if (!nonce || !userId || !exp || !sig) {
    return {
      valid: false,
      error: "Incomplete punch token. Please clock in from the application.",
    };
  }

  // 1. Verify user binding
  if (userId.toString() !== expectedUserId.toString()) {
    return {
      valid: false,
      error: "Punch token does not match your active user account.",
    };
  }

  // 2. Verify signature
  const dataToSign = `${nonce}:${userId}:${exp}`;
  const expectedSignature = crypto
    .createHmac("sha256", getPunchSecret())
    .update(dataToSign)
    .digest("hex");

  if (sig !== expectedSignature) {
    return {
      valid: false,
      error: "Invalid punch token signature. Request rejected.",
    };
  }

  // 3. Verify timestamp (45-second window)
  const now = Date.now();
  if (now > exp) {
    return {
      valid: false,
      error: "Punch token has expired (45s window elapsed). Please click Clock In again.",
    };
  }

  // 4. Atomically burn the nonce in MongoDB (cannot be reused)
  const consumed = await PunchNonce.findOneAndUpdate(
    {
      nonce,
      userId,
      used: false,
      expiresAt: { $gte: new Date() },
    },
    {
      $set: {
        used: true,
        usedAt: new Date(),
      },
    },
    { new: true }
  );

  if (!consumed) {
    return {
      valid: false,
      error: "This punch token has already been used or expired. Each punch requires a fresh session in the application.",
    };
  }

  return { valid: true };
};

