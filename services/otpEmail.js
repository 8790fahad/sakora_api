const verificationEmail = ({ firstName, code, intro }) => {
  const text = [
    `Dear ${firstName},`,
    "",
    intro,
    "",
    code,
    "",
    "This code will expire in fifteen minutes.",
    "",
    "If you didn't request this verification, please ignore this email.",
    "",
    "Best regards,",
    "Sakora",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <p style="margin:0 0 16px;font-size:16px;">Dear ${firstName},</p>
  <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${intro}</p>
  <p style="margin:8px 0 24px;font-size:32px;font-weight:700;color:#16a34a;text-align:center;">${code}</p>
  <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">This code will expire in fifteen minutes.</p>
  <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">If you didn't request this verification, please ignore this email.</p>
  <p style="margin:0;font-size:16px;line-height:1.5;">Best regards,<br>Sakora</p>
</body>
</html>`;

  return { text, html };
};

module.exports = { verificationEmail };
