import { randomBytes } from "crypto";
import { describe, expect, it } from "vitest";
import {
  SettingsEncryptionService,
  createSettingsEncryptionKey,
} from "./settings-encryption";

const keyHex = randomBytes(32).toString("hex");

describe("createSettingsEncryptionKey", () => {
  it("accepts a 64-char hex key", () => {
    const key = createSettingsEncryptionKey(keyHex);
    expect(key.length).toBe(32);
  });

  it("accepts a base64-encoded 32-byte key", () => {
    const base64 = randomBytes(32).toString("base64");
    const key = createSettingsEncryptionKey(base64);
    expect(key.length).toBe(32);
  });

  it("rejects a key that does not decode to 32 bytes", () => {
    expect(() => createSettingsEncryptionKey("too-short")).toThrow();
    expect(() => createSettingsEncryptionKey(randomBytes(16).toString("hex"))).toThrow();
  });
});

describe("SettingsEncryptionService", () => {
  const service = new SettingsEncryptionService(createSettingsEncryptionKey(keyHex));

  it("round-trips a value", () => {
    const plaintext = JSON.stringify({ apiKey: "sk-secret-value" });
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toContain("sk-secret-value");
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it("produces the versioned envelope prefix", () => {
    const encrypted = service.encrypt("hello");
    expect(encrypted.startsWith("enc:v1:")).toBe(true);
    expect(service.isEncrypted(encrypted)).toBe(true);
  });

  it("uses a fresh iv per call so ciphertexts differ", () => {
    const first = service.encrypt("same");
    const second = service.encrypt("same");
    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe("same");
    expect(service.decrypt(second)).toBe("same");
  });

  it("passes through plaintext on decrypt (backward-compatible with legacy rows)", () => {
    const legacyPlaintext = JSON.stringify({ apiKey: "legacy" });
    expect(service.isEncrypted(legacyPlaintext)).toBe(false);
    expect(service.decrypt(legacyPlaintext)).toBe(legacyPlaintext);
  });

  it("fails to decrypt a tampered envelope", () => {
    const encrypted = service.encrypt("secret");
    const tampered = encrypted.slice(0, -4) + "AAAA";
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it("cannot decrypt a value encrypted under a different key", () => {
    const other = new SettingsEncryptionService(
      createSettingsEncryptionKey(randomBytes(32).toString("hex")),
    );
    const encrypted = service.encrypt("secret");
    expect(() => other.decrypt(encrypted)).toThrow();
  });
});
