import type { SystemSetting } from "../entities/system-setting";
import type { Result } from "../result";

export interface ISystemSettingsRepository {
  get(key: string): Promise<Result<SystemSetting | null>>;
  set(key: string, value: string): Promise<Result<SystemSetting>>;
}
