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

  const subject = "Verify your Sakora email";
  const text = `Your Sakora verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color: #0f766e; margin-bottom: 8px;">Verify your email</h2>
      <p style="color: #334155; line-height: 1.5;">
        Enter this code in Sakora to finish creating your account:
      </p>
      <p style="font-size: 32px; letter-spacing: 6px; font-weight: 700; color: #0f766e; margin: 24px 0;">
        ${code}
      </p>
      <p style="color: #64748b; font-size: 14px;">
        This code expires in ${CODE_TTL_MINUTES} minutes. If you did not sign up for Sakora, you can ignore this email.
      </p>
    </div>
  `;

  if (process.env.NODE_ENV !== "production") {
    console.log(`[verify] email code for ${user.email}: ${code}`);
  }

  const result = await sendEmail({
    businessId: user.businessId,
    to: user.email,
    subject,
    text,
    html,
    templateKey: "email_verification",
  });

  return { expiresAt, result, code };
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
