import type { SystemSetting } from "../entities/system-setting";
import type { Result } from "../result";

export interface ISystemSettingsRepository {
  get(key: string): Promise<Result<SystemSetting | null>>;
  set(key: string, value: string): Promise<Result<SystemSetting>>;
  // Removes a row entirely. Used to void the one-time setup token once an admin
  // is created (ADR-041 §0). Deleting an absent key is not an error.
  delete(key: string): Promise<Result<void>>;
}
