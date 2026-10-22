const crypto = require("crypto");
const { sendEmail } = require("./mail");

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
  const subject = "Verify your Sakora account";
  const text = [
    `Hi ${firstName},`,
    "",
    "Welcome to Sakora. Use this code to verify your email and finish creating your account:",
    "",
    code,
    "",
    `This code expires in ${CODE_TTL_MINUTES} minutes.`,
    "If you did not sign up for Sakora, you can ignore this email.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 12px;">
      <div style="background: #0f766e; color: #fff; padding: 20px 24px; border-radius: 10px 10px 0 0;">
        <p style="margin: 0; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85;">Sakora</p>
        <h1 style="margin: 8px 0 0; font-size: 22px; font-weight: 700;">Welcome — verify your email</h1>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #e2e8f0; border-top: 0; border-radius: 0 0 10px 10px;">
        <p style="color: #334155; line-height: 1.55; margin: 0 0 16px;">
          Hi ${firstName}, thanks for registering. Enter this code in Sakora to activate your account:
        </p>
        <p style="font-size: 34px; letter-spacing: 8px; font-weight: 700; color: #0f766e; margin: 8px 0 20px; text-align: center;">
          ${code}
        </p>
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin: 0;">
          This code expires in ${CODE_TTL_MINUTES} minutes. If you did not sign up for Sakora, you can ignore this email.
        </p>
      </div>
    </div>
  `;

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
