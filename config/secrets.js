const DEV_FALLBACK = "sakora-dev-secret-key-change-in-production";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret === DEV_FALLBACK || secret.length < 32) {
      throw new Error(
        "JWT_SECRET must be set to a strong value (32+ chars) in production"
      );
    }
    return secret;
  }
  return secret || DEV_FALLBACK;
}

module.exports = { getJwtSecret, DEV_FALLBACK };
