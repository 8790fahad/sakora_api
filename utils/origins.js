const parseOrigins = (value) =>
  (value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const shopOrigins = [
  "https://sakora.shop",
  "https://www.sakora.shop",
  "https://nexifour.ng",
  "https://www.nexifour.ng",
];

function getAllowedOrigins() {
  const extraOrigins = parseOrigins(process.env.CORS_ORIGIN);

  for (const key of ["FRONTEND_URL", "STOREFRONT_URL"]) {
    if (!process.env[key]) continue;
    try {
      extraOrigins.push(new URL(process.env[key]).origin);
    } catch (error) {
      // ignore invalid URL
    }
  }

  return new Set([
    ...shopOrigins,
    ...extraOrigins,
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
  ]);
}

function isOriginAllowed(origin, allowed = getAllowedOrigins()) {
  if (!origin) return true;
  return allowed.has(origin);
}

module.exports = { getAllowedOrigins, isOriginAllowed, parseOrigins };
