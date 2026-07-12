import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Envelope: `enc:v1:<base64(iv | authTag | ciphertext)>`. The version segment
// lets a future scheme be introduced without a data migration, and the prefix
// lets `decrypt` distinguish an encrypted value from a legacy plaintext row.
const ENVELOPE_PREFIX = "enc:v1:";
const IV_LENGTH_BYTES = 12; // GCM standard nonce length
const AUTH_TAG_LENGTH_BYTES = 16;
const KEY_LENGTH_BYTES = 32; // AES-256

/**
 * Parses a raw key string (hex or base64) into a 32-byte buffer. Throws on any
 * value that does not decode to exactly 32 bytes so a misconfigured key fails
 * fast at startup rather than silently weakening encryption.
 */
export const createSettingsEncryptionKey = (raw: string): Buffer => {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `SETTINGS_ENCRYPTION_KEY must decode to ${KEY_LENGTH_BYTES} bytes (64 hex chars or a base64-encoded 32-byte value).`,
    );
  }
  return decoded;
};

/**
 * AES-256-GCM encryption for system-setting values stored at rest. Encryption
 * is authenticated, so any tampering with a stored ciphertext is detected on
 * decrypt. `decrypt` treats an un-prefixed value as legacy plaintext and returns
 * it unchanged, so existing rows keep working and are re-encrypted on next write.
 */
export class SettingsEncryptionService {
  constructor(private readonly key: Buffer) {
    if (key.length !== KEY_LENGTH_BYTES) {
      throw new Error(`Settings encryption key must be ${KEY_LENGTH_BYTES} bytes.`);
    }
  }

  isEncrypted(value: string): boolean {
    return value.startsWith(ENVELOPE_PREFIX);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, ciphertext]);
    return ENVELOPE_PREFIX + packed.toString("base64");
  }

  decrypt(value: string): string {
    if (!this.isEncrypted(value)) return value;
    const packed = Buffer.from(value.slice(ENVELOPE_PREFIX.length), "base64");
    const iv = packed.subarray(0, IV_LENGTH_BYTES);
    const authTag = packed.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const ciphertext = packed.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
