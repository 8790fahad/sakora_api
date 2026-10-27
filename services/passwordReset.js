const crypto = require("crypto");
const { sendEmail } = require("./mail");
const { codesMatch } = require("./emailVerification");
const { verificationEmail } = require("./otpEmail");

const CODE_TTL_MINUTES = 15;

const hashCode = (code) =>
  crypto.createHash("sha256").update(String(code)).digest("hex");

const generateCode = () => String(crypto.randomInt(100000, 999999));

const issuePasswordReset = async (user) => {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await user.update({
    passwordResetCode: hashCode(code),
    passwordResetExpires: expiresAt,
  });

  const firstName = user.firstName || "there";
  const subject = "Verify your email address";
  const { text, html } = verificationEmail({
    firstName,
    code,
    intro:
      "Please use the following verification code to reset your Sakora password:",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[password-reset] code for ${user.email}: ${code}`);
  }

  const result = await sendEmail({
    businessId: user.businessId,
    to: user.email,
    subject,
    text,
    html,
    templateKey: "password_reset",
  });

  return { expiresAt, result, code };
};

module.exports = {
  CODE_TTL_MINUTES,
  issuePasswordReset,
  codesMatch,
};
