const { OAuth2Client } = require("google-auth-library");

const getClientIds = () =>
  [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_ID,
  ].filter(Boolean);

const isConfigured = () => getClientIds().length > 0;

let client = null;

const getClient = () => {
  if (!client) client = new OAuth2Client();
  return client;
};

const verifyGoogleIdToken = async (idToken) => {
  const audiences = getClientIds();
  if (!audiences.length) {
    throw new Error("Google sign-in is not configured");
  }

  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });

  const payload = ticket.getPayload();
  if (!payload?.email) {
    throw new Error("Google account did not return an email address");
  }

  if (payload.email_verified === false) {
    throw new Error("Google email is not verified");
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).trim().toLowerCase(),
    emailVerified: Boolean(payload.email_verified),
    firstName: payload.given_name || "",
    lastName: payload.family_name || "",
    fullName: payload.name || "",
    avatar: payload.picture || null,
  };
};

module.exports = {
  isConfigured,
  verifyGoogleIdToken,
};
