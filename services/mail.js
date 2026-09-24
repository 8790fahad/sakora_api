const db = require("../models");

const MAILTRAP_TOKEN = process.env.MAILTRAP_TOKEN || process.env.MAILTRAP_API_KEY || "";
const MAILTRAP_HOST = process.env.MAILTRAP_HOST || "sandbox.smtp.mailtrap.io";
const MAILTRAP_PORT = parseInt(process.env.MAILTRAP_PORT || "2525", 10);
const MAILTRAP_USER = process.env.MAILTRAP_USER || "";
const MAILTRAP_PASS = process.env.MAILTRAP_PASS || "";
const MAILTRAP_INBOX_ID = process.env.MAILTRAP_INBOX_ID || "";
const MAILTRAP_FROM = process.env.MAILTRAP_FROM || "sakora@example.com";
const MAILTRAP_FROM_NAME = process.env.MAILTRAP_FROM_NAME || "Sakora";

const isConfigured = () =>
  Boolean(MAILTRAP_TOKEN || (MAILTRAP_USER && MAILTRAP_PASS));

const sendViaApi = async ({ to, subject, text, html }) => {
  const sandbox = Boolean(MAILTRAP_INBOX_ID);
  const url = sandbox
    ? `https://sandbox.api.mailtrap.io/api/send/${MAILTRAP_INBOX_ID}`
    : "https://send.api.mailtrap.io/api/send";

  const response = await fetch(url, {
    method: "POST",
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

const sendViaSmtp = async ({ to, subject, text, html }) => {
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: MAILTRAP_HOST,
    port: MAILTRAP_PORT,
    auth: { user: MAILTRAP_USER, pass: MAILTRAP_PASS },
  });
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
    const info = MAILTRAP_TOKEN
      ? await sendViaApi({ to, subject, text, html })
      : await sendViaSmtp({ to, subject, text, html });

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
