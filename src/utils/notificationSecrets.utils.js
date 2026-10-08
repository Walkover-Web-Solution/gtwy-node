import crypto from "crypto";

// Same cipher, key and IV derivation as encrypt/decrypt in services/utils/utility.service.js,
// kept dependency-free so the alerts migration can import it without loading the app.
const algorithm = "aes-256-cbc";

function getKeyAndIv() {
  const encryptionKey = crypto
    .createHash("sha512")
    .update(process.env.ENCRYPTION_SECRET_KEY || "")
    .digest("hex")
    .substring(0, 32);
  const iv = crypto
    .createHash("sha512")
    .update(process.env.ENCRYPTION_SECRET_IV || "")
    .digest("hex")
    .substring(0, 16);
  return { encryptionKey, iv };
}

function encryptSecret(value) {
  const { encryptionKey, iv } = getKeyAndIv();
  const cipher = crypto.createCipheriv(algorithm, encryptionKey, iv);
  return cipher.update(JSON.stringify(value), "utf8", "hex") + cipher.final("hex");
}

function decryptSecret(encrypted) {
  if (!encrypted) return null;
  const { encryptionKey, iv } = getKeyAndIv();
  const decipher = crypto.createDecipheriv(algorithm, encryptionKey, iv);
  return JSON.parse(decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8"));
}

// Shows enough of a secret to recognise it, never the whole value.
function maskSecret(value) {
  const text = String(value ?? "");
  if (text.length <= 8) return "••••";
  return `${text.slice(0, 4)}••••${text.slice(-4)}`;
}

export { encryptSecret, decryptSecret, maskSecret };
