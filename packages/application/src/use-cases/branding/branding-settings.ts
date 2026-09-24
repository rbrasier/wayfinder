import {
  BRANDING_CONFIG_SETTING_KEY,
  createDefaultBrandingConfig,
  ok,
  parseBrandingConfig,
  type BrandingConfig,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";

// A read failure is returned, never replaced with the defaults: every writer
// merges into the current row, and writing defaults over an unreadable row would
// silently wipe the logo, name and colour.
export const readBrandingConfig = async (
  systemSettings: ISystemSettingsRepository,
): Promise<Result<BrandingConfig>> => {
  const result = await systemSettings.get(BRANDING_CONFIG_SETTING_KEY);
  if (result.error) return result;
  if (!result.data) return ok(createDefaultBrandingConfig());
  return ok(parseBrandingConfig(result.data.value));
};

export const writeBrandingConfig = async (
  systemSettings: ISystemSettingsRepository,
  config: BrandingConfig,
): Promise<Result<BrandingConfig>> => {
  const result = await systemSettings.set(BRANDING_CONFIG_SETTING_KEY, JSON.stringify(config));
  if (result.error) return result;
  return ok(config);
};
