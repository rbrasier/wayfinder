import { randomBytes } from "crypto";
import {
  AI_CONFIG_SETTING_KEY,
  REGISTRATION_ENABLED_SETTING_KEY,
  ok,
  type ISystemSettingsRepository,
  type SystemSetting,
} from "@rbrasier/domain";
import { describe, expect, it } from "vitest";
import {
  SettingsEncryptionService,
  createSettingsEncryptionKey,
} from "../config/settings-encryption";
import { EncryptedSystemSettingsRepository } from "./encrypted-system-settings-repository";

const encryption = new SettingsEncryptionService(
  createSettingsEncryptionKey(randomBytes(32).toString("hex")),
);

class InMemorySettingsRepo implements ISystemSettingsRepository {
  readonly store = new Map<string, string>();

  async get(key: string) {
    const value = this.store.get(key);
    if (value === undefined) return ok(null);
    return ok<SystemSetting>({ key, value, createdAt: new Date(), updatedAt: new Date() });
  }

  async set(key: string, value: string) {
    this.store.set(key, value);
    return ok<SystemSetting>({ key, value, createdAt: new Date(), updatedAt: new Date() });
  }
}

describe("EncryptedSystemSettingsRepository", () => {
  it("encrypts the stored value for a sensitive key", async () => {
    const inner = new InMemorySettingsRepo();
    const repo = new EncryptedSystemSettingsRepository(inner, encryption);
    const plaintext = JSON.stringify({ apiKeys: { anthropic: "sk-secret" } });

    await repo.set(AI_CONFIG_SETTING_KEY, plaintext);

    const raw = inner.store.get(AI_CONFIG_SETTING_KEY)!;
    expect(raw).not.toContain("sk-secret");
    expect(encryption.isEncrypted(raw)).toBe(true);
  });

  it("returns the decrypted value on read", async () => {
    const inner = new InMemorySettingsRepo();
    const repo = new EncryptedSystemSettingsRepository(inner, encryption);
    const plaintext = JSON.stringify({ apiKeys: { anthropic: "sk-secret" } });

    await repo.set(AI_CONFIG_SETTING_KEY, plaintext);
    const result = await repo.get(AI_CONFIG_SETTING_KEY);

    expect(result.error).toBeUndefined();
    expect(result.data?.value).toBe(plaintext);
  });

  it("stores non-sensitive keys as plaintext", async () => {
    const inner = new InMemorySettingsRepo();
    const repo = new EncryptedSystemSettingsRepository(inner, encryption);

    await repo.set(REGISTRATION_ENABLED_SETTING_KEY, "false");

    expect(inner.store.get(REGISTRATION_ENABLED_SETTING_KEY)).toBe("false");
  });

  it("reads a legacy plaintext value written before encryption was enabled", async () => {
    const inner = new InMemorySettingsRepo();
    const legacy = JSON.stringify({ apiKeys: { anthropic: "sk-legacy" } });
    inner.store.set(AI_CONFIG_SETTING_KEY, legacy);
    const repo = new EncryptedSystemSettingsRepository(inner, encryption);

    const result = await repo.get(AI_CONFIG_SETTING_KEY);

    expect(result.data?.value).toBe(legacy);
  });

  it("passes through a null read", async () => {
    const inner = new InMemorySettingsRepo();
    const repo = new EncryptedSystemSettingsRepository(inner, encryption);
    const result = await repo.get(AI_CONFIG_SETTING_KEY);
    expect(result.data).toBeNull();
  });
});
