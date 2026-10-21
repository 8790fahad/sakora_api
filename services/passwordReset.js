const crypto = require("crypto");
const { sendEmail } = require("./mail");
const { codesMatch } = require("./emailVerification");

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

  const subject = "Reset your Sakora password";
  const text = `Your Sakora password reset code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f766e; margin-bottom: 8px;">Reset your password</h2>
      <p style="color: #334155; line-height: 1.5;">
        Enter this code in Sakora to choose a new password:
      </p>
      <p style="font-size: 32px; letter-spacing: 6px; font-weight: 700; color: #0f766e; margin: 24px 0;">
        ${code}
      </p>
      <p style="color: #64748b; font-size: 14px;">
        This code expires in ${CODE_TTL_MINUTES} minutes. If you did not request a reset, you can ignore this email.
      </p>
    </div>
  `;

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
