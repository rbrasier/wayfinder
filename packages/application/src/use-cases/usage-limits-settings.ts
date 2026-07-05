import {
  DEFAULT_USAGE_LIMITS_CONFIG,
  USAGE_LIMITS_CONFIG_SETTING_KEY,
  ok,
  parseUsageLimitsConfig,
  type ISystemSettingsRepository,
  type Result,
} from "@rbrasier/domain";

// Read the usage-limits master switch. A missing row means an unconfigured
// install, which defaults to on (ADR-031) so nothing is enforced until a limit
// is actually set.
export class GetUsageLimitsEnabled {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(): Promise<Result<boolean>> {
    const result = await this.systemSettings.get(USAGE_LIMITS_CONFIG_SETTING_KEY);
    if (result.error) return result;
    if (!result.data) return ok(DEFAULT_USAGE_LIMITS_CONFIG.enabled);
    return ok(parseUsageLimitsConfig(result.data.value).enabled);
  }
}

export class SetUsageLimitsEnabled {
  constructor(private readonly systemSettings: ISystemSettingsRepository) {}

  async execute(enabled: boolean): Promise<Result<boolean>> {
    const result = await this.systemSettings.set(
      USAGE_LIMITS_CONFIG_SETTING_KEY,
      JSON.stringify({ enabled }),
    );
    if (result.error) return result;
    return ok(enabled);
  }
}
