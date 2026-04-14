const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:3000";
const verificationStore = new Map();
const userStore = new Map();

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

function startVerification(channel, destination, mode, prefix, res) {
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

  verificationStore.set(verificationId, {
    channel,
    destination: normalisedDestination,
    mode,
    code: previewCode,
    createdAt: Date.now(),
  });

  return res.status(201).json({
    verificationId,
    message: `Verification code sent to your ${channel}.`,
    previewCode,
  });
}

function verifyCode(channel, verificationId, code, mode, res) {
  const record = verificationStore.get(verificationId);

  if (!record || record.channel !== channel) {
    return res.status(404).json({ message: "Verification session not found." });
  }

  if (record.mode !== mode) {
    return res.status(400).json({ message: "Verification mode mismatch." });
  }

  if (record.code !== code) {
    return res.status(400).json({ message: "Incorrect verification code. Please try again." });
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
    authBaseURL: FRONTEND_BASE_URL,
    endpoints: [
      "/auth/email/start",
      "/auth/email/verify",
      "/auth/phone/start",
      "/auth/phone/verify",
    ],
  });
});

app.post("/auth/email/start", (req, res) => {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const mode = String(req.body?.mode ?? "");

  if (!email) {
    return res.status(400).json({ message: "Email is required." });
  }

  return startVerification("email", email, mode, "ver_email", res);
});

app.post("/auth/email/verify", (req, res) => {
  const verificationId = String(req.body?.verificationId ?? "");
  const code = String(req.body?.code ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  return verifyCode("email", verificationId, code, mode, res);
});

app.post("/auth/phone/start", (req, res) => {
  const phoneNumber = String(req.body?.phoneNumber ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  if (!phoneNumber) {
    return res.status(400).json({ message: "Phone number is required." });
  }

  return startVerification("phone", phoneNumber, mode, "ver_phone", res);
});

app.post("/auth/phone/verify", (req, res) => {
  const verificationId = String(req.body?.verificationId ?? "");
  const code = String(req.body?.code ?? "").trim();
  const mode = String(req.body?.mode ?? "");

  return verifyCode("phone", verificationId, code, mode, res);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
