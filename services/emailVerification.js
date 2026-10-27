const crypto = require("crypto");
const { sendEmail } = require("./mail");
const { verificationEmail } = require("./otpEmail");

const CODE_TTL_MINUTES = 15;

const hashCode = (code) =>
  crypto.createHash("sha256").update(String(code)).digest("hex");

const generateCode = () => String(crypto.randomInt(100000, 999999));

const issueEmailVerification = async (user) => {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

  await user.update({
    emailVerificationCode: hashCode(code),
    emailVerificationExpires: expiresAt,
    emailVerified: false,
  });

  const firstName = user.firstName || "there";
  const subject = "Verify your email address";
  const { text, html } = verificationEmail({
    firstName,
    code,
    intro:
      "Thank you for registering with Sakora. Please use the following verification code to complete your registration:",
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[verify] email code for ${user.email}: ${code}`);
  }

  // The code is already saved. Don't make signup wait on Mailtrap retries.
  sendEmail({
    businessId: user.businessId,
    to: user.email,
    subject,
    text,
    html,
    templateKey: "email_verification",
  })
    .then((result) => {
      if (result?.error) {
        console.error(
          `[verify] failed to email ${user.email}: ${result.error}`
        );
      } else if (result?.skipped) {
        console.warn(
          `[verify] email skipped for ${user.email}: ${result.reason}`
        );
      } else {
        console.log(`[verify] verification email sent to ${user.email}`);
      }
    })
    .catch((error) => {
      console.error(`[verify] failed to email ${user.email}:`, error.message);
    });

  return { expiresAt, code };
};

const codesMatch = (input, storedHash) => {
  if (!input || !storedHash) return false;
  const incoming = hashCode(input.trim());
  try {
    return crypto.timingSafeEqual(
      Buffer.from(incoming),
      Buffer.from(String(storedHash))
    );
  } catch {
    return incoming === String(storedHash);
  }
};

module.exports = {
  CODE_TTL_MINUTES,
  issueEmailVerification,
  codesMatch,
};
