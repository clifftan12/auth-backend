const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3000";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || FRONTEND_BASE_URL)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const NODE_ENV = process.env.NODE_ENV || "development";
const ALLOW_PREVIEW_CODE = process.env.ALLOW_PREVIEW_CODE === "true" || NODE_ENV !== "production";
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID || "";
const EMAIL_PROVIDER_API_KEY = process.env.EMAIL_PROVIDER_API_KEY || "";
const EMAIL_PROVIDER_FROM = process.env.EMAIL_PROVIDER_FROM || "";
const EMAIL_PROVIDER_API_URL =
  process.env.EMAIL_PROVIDER_API_URL || "https://api.sendgrid.com/v3/mail/send";
const verificationStore = new Map();
const userStore = new Map();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin not allowed by CORS"));
    },
  })
);

function makeUserKey(channel, destination) {
  return `${channel}:${destination.trim().toLowerCase()}`;
}

function createPreviewCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
}

function createVerificationId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function createTokens() {
  return {
    accessToken: crypto.randomUUID(),
    refreshToken: crypto.randomUUID(),
  };
}

function buildUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    phoneNumber: user.phoneNumber,
    hasCompletedProfile: user.hasCompletedProfile,
  };
}

function deleteUserRecords({ userId, email, phoneNumber }) {
  const normalisedEmail = email ? email.trim().toLowerCase() : "";
  const normalisedPhone = phoneNumber ? phoneNumber.trim().toLowerCase() : "";
  const deletedDestinations = new Set();

  for (const [key, user] of userStore.entries()) {
    const matchesUserId = Boolean(userId && user.id === userId);
    const matchesEmail = Boolean(normalisedEmail && user.email?.trim().toLowerCase() === normalisedEmail);
    const matchesPhone = Boolean(
      normalisedPhone && user.phoneNumber?.trim().toLowerCase() === normalisedPhone
    );

    if (matchesUserId || matchesEmail || matchesPhone) {
      deletedDestinations.add(user.email?.trim().toLowerCase());
      deletedDestinations.add(user.phoneNumber?.trim().toLowerCase());
      userStore.delete(key);
    }
  }

  for (const [verificationId, record] of verificationStore.entries()) {
    const destination = record.destination?.trim().toLowerCase();
    if (deletedDestinations.has(destination) || destination === normalisedEmail || destination === normalisedPhone) {
      verificationStore.delete(verificationId);
    }
  }
}

function isTwilioConfigured() {
  return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_VERIFY_SERVICE_SID);
}

function isEmailProviderConfigured() {
  return Boolean(EMAIL_PROVIDER_API_KEY && EMAIL_PROVIDER_FROM);
}

async function sendPhoneCode(destination, code) {
  if (isTwilioConfigured()) {
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const body = new URLSearchParams({
      To: destination,
      Channel: "sms",
    });

    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Twilio Verify failed: ${text}`);
    }

    return;
  }

  if (!ALLOW_PREVIEW_CODE) {
    throw new Error("Phone verification provider is not configured.");
  }
}

async function sendEmailCode(destination, code) {
  if (isEmailProviderConfigured()) {
    const response = await fetch(EMAIL_PROVIDER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${EMAIL_PROVIDER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: destination }],
            subject: "Your iinite verification code",
          },
        ],
        from: { email: EMAIL_PROVIDER_FROM, name: "iinite" },
        content: [
          {
            type: "text/plain",
            value: `Your iinite verification code is ${code}. This code will expire soon.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Email provider failed: ${text}`);
    }

    return;
  }

  if (!ALLOW_PREVIEW_CODE) {
    throw new Error("Email verification provider is not configured.");
  }
}

async function verifyPhoneCodeWithTwilio(destination, code) {
  const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const body = new URLSearchParams({
    To: destination,
    Code: code,
  });

  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Twilio Verify check failed: ${text}`);
  }

  const payload = await response.json();
  return payload.status === "approved";
}

async function startVerification(channel, destination, mode, prefix, res) {
  const normalisedDestination = destination.trim();
  const userKey = makeUserKey(channel, normalisedDestination);
  const existingUser = userStore.get(userKey);

  if (!["signIn", "signUp"].includes(mode)) {
    return res.status(400).json({ message: "Invalid verification mode." });
  }

  if (mode === "signIn" && !existingUser) {
    return res.status(404).json({ message: `No account found for this ${channel}.` });
  }

  if (mode === "signUp" && existingUser) {
    return res.status(409).json({ message: `An account already exists for this ${channel}.` });
  }

  const verificationId = createVerificationId(prefix);
  const previewCode = createPreviewCode();

  try {
    if (channel === "phone") {
      await sendPhoneCode(normalisedDestination, previewCode);
    } else {
      await sendEmailCode(normalisedDestination, previewCode);
    }

    verificationStore.set(verificationId, {
      channel,
      destination: normalisedDestination,
      mode,
      code: channel === "phone" && isTwilioConfigured() ? null : previewCode,
      createdAt: Date.now(),
    });
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Unable to send verification code.",
    });
  }

  return res.status(201).json({
    verificationId,
    message: `Verification code sent to your ${channel}.`,
    ...(channel === "phone" && isTwilioConfigured() ? {} : ALLOW_PREVIEW_CODE ? { previewCode } : {}),
  });
}

async function verifyCode(channel, verificationId, code, mode, res) {
  const record = verificationStore.get(verificationId);

  if (!record || record.channel !== channel) {
    return res.status(404).json({ message: "Verification session not found." });
  }

  if (record.mode !== mode) {
    return res.status(400).json({ message: "Verification mode mismatch." });
  }

  try {
    if (channel === "phone" && isTwilioConfigured()) {
      const isApproved = await verifyPhoneCodeWithTwilio(record.destination, code);
      if (!isApproved) {
        return res.status(400).json({ message: "Incorrect verification code. Please try again." });
      }
    } else if (record.code !== code) {
      return res.status(400).json({ message: "Incorrect verification code. Please try again." });
    }
  } catch (error) {
    return res.status(500).json({
      message: error instanceof Error ? error.message : "Unable to verify code.",
    });
  }

  const userKey = makeUserKey(channel, record.destination);
  let user = userStore.get(userKey);

  if (!user && mode === "signUp") {
    user = {
      id: crypto.randomUUID(),
      email: channel === "email" ? record.destination : null,
      phoneNumber: channel === "phone" ? record.destination : null,
      hasCompletedProfile: false,
    };
    userStore.set(userKey, user);
  }

  if (!user) {
    return res.status(404).json({ message: "Account not found." });
  }

  verificationStore.delete(verificationId);

  return res.json({
    success: true,
    message: `${channel === "phone" ? "Phone" : "Email"} verified.`,
    user: buildUserResponse(user),
    session: createTokens(),
  });
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    environment: NODE_ENV,
    endpoints: [
      "/auth/email/start",
      "/auth/email/verify",
      "/auth/phone/start",
      "/auth/phone/verify",
    ],
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "auth-backend",
    environment: NODE_ENV,
    providers: {
      phone: isTwilioConfigured() ? "twilio" : ALLOW_PREVIEW_CODE ? "preview" : "missing",
      email: isEmailProviderConfigured() ? "email-provider" : ALLOW_PREVIEW_CODE ? "preview" : "missing",
    },
  });
});

app.post("/auth/email/start", async (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const mode = String(req.body?.mode ?? "");

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  return startVerification("email", email, mode, "ver_email", res);
});

app.post("/auth/email/verify", async (req, res) => {
  const verificationId = String(req.body?.verificationId ?? "");
  const code = String(req.body?.code ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  return verifyCode("email", verificationId, code, mode, res);
});

app.post("/auth/phone/start", async (req, res) => {
  const phoneNumber = String(req.body?.phoneNumber ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  if (!phoneNumber) {
    return res.status(400).json({ message: "Phone number is required." });
  }

  return startVerification("phone", phoneNumber, mode, "ver_phone", res);
});

app.post("/auth/phone/verify", async (req, res) => {
  const verificationId = String(req.body?.verificationId ?? "");
  const code = String(req.body?.code ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  return verifyCode("phone", verificationId, code, mode, res);
});

app.post("/account/delete", (req, res) => {
  const userId = String(req.body?.userId ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const phoneNumber = String(req.body?.phoneNumber ?? "").trim();

  if (!userId && !email && !phoneNumber) {
    return res.status(400).json({ message: "Account details are required to delete this account." });
  }

  deleteUserRecords({ userId, email, phoneNumber });

  return res.json({
    success: true,
    message: "Account deleted.",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
