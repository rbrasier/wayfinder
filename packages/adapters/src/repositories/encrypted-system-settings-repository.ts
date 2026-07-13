import {
  isSensitiveSettingKey,
  type ISystemSettingsRepository,
  type Result,
  type SystemSetting,
} from "@rbrasier/domain";
import type { SettingsEncryptionService } from "../config/settings-encryption";

/**
 * Wraps a system-settings repository to encrypt secret-bearing values at rest
 * (ADR: settings-at-rest). Only keys in `SENSITIVE_SETTING_KEYS` are encrypted;
 * other keys stay plaintext so they remain queryable and cheap on public/hot
 * paths. Decryption is envelope-aware, so legacy plaintext rows keep working and
 * are transparently re-encrypted the next time they are written.
 */
export class EncryptedSystemSettingsRepository implements ISystemSettingsRepository {
  constructor(
    private readonly inner: ISystemSettingsRepository,
    private readonly encryption: SettingsEncryptionService,
  ) {}

  async get(key: string): Promise<Result<SystemSetting | null>> {
    const result = await this.inner.get(key);
    if (result.error || !result.data) return result;
    if (!isSensitiveSettingKey(key)) return result;
    return { data: { ...result.data, value: this.encryption.decrypt(result.data.value) } };
  }

  async set(key: string, value: string): Promise<Result<SystemSetting>> {
    const stored = isSensitiveSettingKey(key) ? this.encryption.encrypt(value) : value;
    const result = await this.inner.set(key, stored);
    if (result.error) return result;
    // Return the caller's plaintext, not the stored ciphertext, so callers that
    // read the returned entity (and RuntimeConfigStore's cache) see the value
    // they wrote.
    return { data: { ...result.data, value } };
  }
}
