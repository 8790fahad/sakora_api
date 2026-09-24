const db = require("../models");

const TOKEN =
  process.env.BULKSMS_API_TOKEN ||
  process.env.BULKSMS_TOKEN ||
  "";
const BASE_URL =
  process.env.BULKSMS_API_BASE || "https://www.bulksmsnigeria.com/api/v2";
const SENDER =
  process.env.BULKSMS_SENDER_ID ||
  process.env.BULKSMS_SENDER ||
  "Sakora";

const isConfigured = () => Boolean(TOKEN);

const toNigeriaMsisdn = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("234")) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `234${digits.slice(1)}`;
  if (digits.length === 10) return `234${digits}`;
  return digits;
};

const sendSms = async ({ businessId, to, body, templateKey = "generic" }) => {
  if (!to) {
    return { skipped: true, reason: "missing_recipient" };
  }

  const recipient = toNigeriaMsisdn(to);

  if (!isConfigured()) {
    console.log(`[sms] skipped (BulkSMS not configured): ${recipient} — ${body}`);
    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "sms",
        recipient,
        subject: null,
        body,
        templateKey,
        status: "skipped",
        errorMessage: "BulkSMS credentials not configured",
      });
    }
    return { skipped: true, reason: "not_configured" };
  }

  try {
    const response = await fetch(`${BASE_URL.replace(/\/$/, "")}/sms`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        from: SENDER,
        to: recipient,
        body,
      }),
    });

    const data = await response.json().catch(() => ({}));
    const ok = response.ok;
    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "sms",
        recipient,
        body,
        templateKey,
        status: ok ? "sent" : "failed",
        providerId: data.data?.id || data.id || null,
        errorMessage: ok ? null : JSON.stringify(data),
        sentAt: ok ? new Date() : null,
        metadata: data,
      });
    }

    if (!ok) {
      console.error("BulkSMS Nigeria error:", data);
    }

    return { skipped: false, ok, data };
  } catch (error) {
    console.error("BulkSMS send error:", error.message);
    if (businessId) {
      await db.MessageLog.create({
        businessId,
        channel: "sms",
        recipient,
        body,
        templateKey,
        status: "failed",
        errorMessage: error.message,
      });
    }
    return { skipped: false, error: error.message };
  }
};

module.exports = { sendSms, isConfigured };
