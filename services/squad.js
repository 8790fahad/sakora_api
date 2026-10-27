const crypto = require("crypto");

const SQUAD_SECRET_KEY = process.env.SQUAD_SECRET_KEY || "";
const SQUAD_PUBLIC_KEY = process.env.SQUAD_PUBLIC_KEY || "";
const SQUAD_BASE_URL =
  process.env.SQUAD_BASE_URL || "https://sandbox-api-d.squadco.com";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
/** Customer shops + order tracking live on the marketing site */
const STOREFRONT_URL = process.env.STOREFRONT_URL || "http://localhost:5174";

const isConfigured = () => Boolean(SQUAD_SECRET_KEY);

const toKobo = (naira) => Math.round(parseFloat(naira || 0) * 100);

const squadRequest = async (path, { method = "GET", body, secret } = {}) => {
  const response = await fetch(`${SQUAD_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret || SQUAD_SECRET_KEY}`,
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
  credentials = null,
}) => {
  const secret = credentials ? credentials.secretKey : SQUAD_SECRET_KEY;
  const publicKey = credentials ? credentials.publicKey : SQUAD_PUBLIC_KEY;
  if (!secret) {
    if (credentials) {
      const error = new Error(
        "Turn on Squad and save your public and secret keys on the Storefront page"
      );
      error.status = 400;
      throw error;
    }
    return {
      mock: true,
      transaction_ref: transactionRef,
      checkout_url: `${callbackUrl}${
        callbackUrl.includes("?") ? "&" : "?"
      }ref=${encodeURIComponent(transactionRef)}&mock=1`,
      public_key: publicKey,
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
    secret,
  });

  return {
    mock: false,
    ...result.data,
    public_key: publicKey,
  };
};

const verifyPayment = async (transactionRef, credentials = null) => {
  const secret = credentials ? credentials.secretKey : SQUAD_SECRET_KEY;
  if (!secret) {
    if (credentials) {
      const error = new Error("Squad is not set up for this shop");
      error.status = 400;
      throw error;
    }
    return {
      mock: true,
      transaction_ref: transactionRef,
      transaction_status: "Success",
      transaction_amount: null,
    };
  }

  const result = await squadRequest(
    `/transaction/verify/${encodeURIComponent(transactionRef)}`,
    { secret }
  );
  return result.data;
};

const isSuccessful = (status) =>
  String(status || "").toLowerCase() === "success";

const timingSafeEqualHex = (a, b) => {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};

const verifyWebhookSignature = (rawBody, signature, secretOverride) => {
  const secret = secretOverride || SQUAD_SECRET_KEY;
  // Merchant webhooks must always present a valid signature.
  // Platform billing may skip the check only outside production when unset.
  if (!secret) {
    return !secretOverride && process.env.NODE_ENV !== "production";
  }
  if (!signature || !rawBody) return false;

  const hash = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex")
    .toUpperCase();

  return timingSafeEqualHex(hash, String(signature).toUpperCase());
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
  STOREFRONT_URL,
};
