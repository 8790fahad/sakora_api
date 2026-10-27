const crypto = require("crypto");

let cachedKey = null;

const encryptionKey = () => {
  if (cachedKey) return cachedKey;
  const raw = String(process.env.SECRETS_KEY || "").trim();
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    cachedKey = Buffer.from(raw, "hex");
    return cachedKey;
  }
  const secret = String(process.env.JWT_SECRET || "");
  if (secret.length < 16) {
    throw new Error("Set SECRETS_KEY or JWT_SECRET before storing payment credentials");
  }
  cachedKey = crypto.scryptSync(secret, "sakora-squad-v1", 32);
  return cachedKey;
};

const encryptSecret = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plain), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const decryptSecret = (packed) => {
  const [version, iv, tag, data] = String(packed || "").split(".");
  if (version !== "v1" || !iv || !tag || !data) return "";
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

module.exports = { encryptSecret, decryptSecret };
