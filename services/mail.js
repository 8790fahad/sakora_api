const db = require("../models");

const MAILTRAP_TOKEN = process.env.MAILTRAP_TOKEN || process.env.MAILTRAP_API_KEY || "";
const MAILTRAP_HOST = process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io";
const MAILTRAP_PORT = parseInt(process.env.MAILTRAP_PORT || "2525", 10);
const MAILTRAP_USER = process.env.MAILTRAP_USER || "";
const MAILTRAP_PASS = process.env.MAILTRAP_PASS || "";
const MAILTRAP_INBOX_ID = process.env.MAILTRAP_INBOX_ID || "";
const MAILTRAP_FROM = process.env.MAILTRAP_FROM || "info@sakora.shop";
const MAILTRAP_FROM_NAME = process.env.MAILTRAP_FROM_NAME || "Sakora";
// Explicit false/0/no disables sandbox even in development (use Sending API / live SMTP).
const MAILTRAP_ALLOW_SANDBOX = (() => {
  const raw = String(process.env.MAILTRAP_ALLOW_SANDBOX || "").toLowerCase();
  if (["false", "0", "no"].includes(raw)) return false;
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  return process.env.NODE_ENV !== "production";
})();

let sandboxTransporter = null;
let liveTransporter = null;

const hasSandboxSmtp = () => Boolean(MAILTRAP_USER && MAILTRAP_PASS);
const hasApiToken = () => Boolean(MAILTRAP_TOKEN);

const isConfigured = () => hasSandboxSmtp() || hasApiToken();

const preferSandboxSmtp = () =>
  hasSandboxSmtp() && (MAILTRAP_ALLOW_SANDBOX || !hasApiToken());

const sendViaApi = async ({ to, subject, text, html }) => {
  const sandbox = Boolean(MAILTRAP_INBOX_ID);
  const url = sandbox
    ? `https://sandbox.api.mailtrap.io/api/send/${MAILTRAP_INBOX_ID}`
    : "https://send.api.mailtrap.io/api/send";

  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${MAILTRAP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: MAILTRAP_FROM, name: MAILTRAP_FROM_NAME },
      to: [{ email: to }],
      subject,
      text,
      html: html || `<p>${text}</p>`,
      category: "sakora",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.errors
      ? JSON.stringify(data.errors)
      : data.message || `Mailtrap API ${response.status}`;
    throw new Error(message);
  }
  return data;
};

const getSandboxTransporter = () => {
  if (sandboxTransporter) return sandboxTransporter;
  const nodemailer = require("nodemailer");
  sandboxTransporter = nodemailer.createTransport({
    host: MAILTRAP_HOST,
    port: MAILTRAP_PORT,
    auth: { user: MAILTRAP_USER, pass: MAILTRAP_PASS },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    pool: true,
    maxConnections: Number(process.env.SMTP_MAX_CONNECTIONS || 3),
    maxMessages: Number(process.env.SMTP_MAX_MESSAGES || 100),
  });
  return sandboxTransporter;
};

/** Mailtrap Email Sending SMTP — uses API token as password */
const getLiveTransporter = () => {
  if (liveTransporter) return liveTransporter;
  if (!hasApiToken()) return null;
  const nodemailer = require("nodemailer");
  liveTransporter = nodemailer.createTransport({
    host: process.env.MAILTRAP_LIVE_HOST || "live.smtp.mailtrap.io",
    port: parseInt(process.env.MAILTRAP_LIVE_PORT || "587", 10),
    secure: false,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
    auth: {
      user: process.env.MAILTRAP_LIVE_USER || "api",
      pass: MAILTRAP_TOKEN,
    },
  });
  return liveTransporter;
};

const sendViaSmtp = async (transporter, { to, subject, text, html }) => {
  return transporter.sendMail({
    from: `"${MAILTRAP_FROM_NAME}" <${MAILTRAP_FROM}>`,
    to,
    subject,
    text,
    html: html || `<p>${text}</p>`,
  });
};

const sendEmail = async ({
  businessId,
  to,
  subject,
  text,
  html,
  templateKey = "generic",
}) => {
  if (!to) {
    return { skipped: true, reason: "missing_recipient" };
  }

  if (!isConfigured()) {
    console.log(`[mail] skipped (Mailtrap not configured): ${subject} -> ${to}`);
    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "email",
        recipient: to,
        subject,
        templateKey,
        status: "skipped",
        errorMessage: "Mailtrap credentials not configured",
        metadata: { text },
      });
    }
    return { skipped: true, reason: "not_configured" };
  }

  try {
    let info;

    if (preferSandboxSmtp()) {
      info = await sendViaSmtp(getSandboxTransporter(), {
        to,
        subject,
        text,
        html,
      });
    } else if (hasApiToken()) {
      try {
        info = await sendViaApi({ to, subject, text, html });
      } catch (apiError) {
        const live = getLiveTransporter();
        if (live) {
          try {
            console.warn(
              `[mail] API send failed (${apiError.message}); trying live SMTP`
            );
            info = await sendViaSmtp(live, { to, subject, text, html });
          } catch (smtpError) {
            if (hasSandboxSmtp()) {
              console.warn(
                `[mail] live SMTP failed (${smtpError.message}); falling back to sandbox`
              );
              info = await sendViaSmtp(getSandboxTransporter(), {
                to,
                subject,
                text,
                html,
              });
            } else {
              throw smtpError;
            }
          }
        } else if (hasSandboxSmtp()) {
          console.warn(
            `[mail] API send failed (${apiError.message}); falling back to sandbox SMTP`
          );
          info = await sendViaSmtp(getSandboxTransporter(), {
            to,
            subject,
            text,
            html,
          });
        } else {
          throw apiError;
        }
      }
    } else {
      info = await sendViaSmtp(getSandboxTransporter(), {
        to,
        subject,
        text,
        html,
      });
    }

    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "email",
        recipient: to,
        subject,
        templateKey,
        status: "sent",
        providerId: info.message_ids?.[0] || info.messageId || null,
        sentAt: new Date(),
        metadata: info,
      });
    }

    return { skipped: false, info };
  } catch (error) {
    console.error("Mailtrap send error:", error.message);
    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "email",
        recipient: to,
        subject,
        templateKey,
        status: "failed",
        errorMessage: error.message,
      });
    }
    return { skipped: false, error: error.message };
  }
};

module.exports = { sendEmail, isConfigured };
