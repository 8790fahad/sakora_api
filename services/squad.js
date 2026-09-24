const crypto = require("crypto");

const SQUAD_SECRET_KEY = process.env.SQUAD_SECRET_KEY || "";
const SQUAD_PUBLIC_KEY = process.env.SQUAD_PUBLIC_KEY || "";
const SQUAD_BASE_URL =
  process.env.SQUAD_BASE_URL || "https://sandbox-api-d.squadco.com";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const isConfigured = () => Boolean(SQUAD_SECRET_KEY);

const toKobo = (naira) => Math.round(parseFloat(naira || 0) * 100);

const squadRequest = async (path, { method = "GET", body } = {}) => {
  const response = await fetch(`${SQUAD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SQUAD_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data.message || data.title || `Squad request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
};

const initiatePayment = async ({
  email,
  amount,
  currency = "NGN",
  customerName,
  transactionRef,
  callbackUrl,
  metadata = {},
  isRecurring = false,
}) => {
  if (!isConfigured()) {
    return {
      mock: true,
      transaction_ref: transactionRef,
      checkout_url: `${callbackUrl}${
        callbackUrl.includes("?") ? "&" : "?"
      }ref=${encodeURIComponent(transactionRef)}&mock=1`,
      public_key: SQUAD_PUBLIC_KEY,
    };
  }

  const payload = {
    email,
    amount: toKobo(amount),
    currency,
    initiate_type: "inline",
    transaction_ref: transactionRef,
    callback_url: callbackUrl,
    customer_name: customerName,
    payment_channels: ["card", "bank", "ussd", "transfer"],
    metadata,
    is_recurring: Boolean(isRecurring),
  };

  const result = await squadRequest("/transaction/initiate", {
    method: "POST",
    body: payload,
  });

  return {
    mock: false,
    ...result.data,
    public_key: SQUAD_PUBLIC_KEY,
  };
};

const verifyPayment = async (transactionRef) => {
  if (!isConfigured()) {
    return {
      mock: true,
      transaction_ref: transactionRef,
      transaction_status: "Success",
      transaction_amount: null,
    };
  }

  const result = await squadRequest(
    `/transaction/verify/${encodeURIComponent(transactionRef)}`
  );
  return result.data;
};

const isSuccessful = (status) =>
  String(status || "").toLowerCase() === "success";

const verifyWebhookSignature = (rawBody, signature) => {
  if (!SQUAD_SECRET_KEY || !signature) return !isConfigured();
  const hash = crypto
    .createHmac("sha512", SQUAD_SECRET_KEY)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();
  return hash === String(signature).toUpperCase();
};

module.exports = {
  isConfigured,
  toKobo,
  initiatePayment,
  verifyPayment,
  isSuccessful,
  verifyWebhookSignature,
  SQUAD_PUBLIC_KEY,
  FRONTEND_URL,
};
