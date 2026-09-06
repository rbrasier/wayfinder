import {
  RETENTION_TARGET_KEYS,
  buildRetentionPolicies,
  domainError,
  err,
  ok,
  type ISystemSettingsRepository,
  type RetentionConfig,
  type RetentionPolicy,
  type RetentionTargetKey,
  type Result,
} from "@rbrasier/domain";

// One settings key per target. The env value stays the fallback (ADR-041 §2), so
// a deployment that set a window in its environment keeps that window until an
// admin overrides it here.
export const retentionSettingKey = (key: RetentionTargetKey): string => `retention.${key}_days`;

// Keep forever. Every target defaults to this, so upgrading into flow memory
// never starts deleting something a deployment was keeping.
export const KEEP_FOREVER = 0;

const CONFIG_FIELD_BY_KEY: Record<RetentionTargetKey, keyof RetentionConfig> = {
  ai_usage_events: "aiUsageEventsDays",
  app_session_messages: "appSessionMessagesDays",
  core_audit_log: "coreAuditLogDays",
  app_error_log: "appErrorLogDays",
  app_notification_log: "appNotificationLogDays",
  app_extraction_runs: "appExtractionRunsDays",
  ai_flow_observations: "aiFlowObservationsDays",
};

const parseWindow = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export class GetRetentionSettings {
  constructor(private readonly settings: ISystemSettingsRepository) {}

  // `envFallback` is the config the container built from environment variables.
  // A stored row wins; an unset key falls back to it.
  async execute(envFallback: RetentionConfig): Promise<Result<RetentionPolicy[]>> {
    const resolved = { ...envFallback };

    for (const key of RETENTION_TARGET_KEYS) {
      const stored = await this.settings.get(retentionSettingKey(key));
      if (stored.error) return err(stored.error);

      const window = parseWindow(stored.data?.value);
      if (window === null) continue;
      resolved[CONFIG_FIELD_BY_KEY[key]] = window;
    }

    return ok(buildRetentionPolicies(resolved));
  }
}

export interface SetRetentionWindowInput {
  key: RetentionTargetKey;
  retentionDays: number;
  isAdmin: boolean;
}

export class SetRetentionWindow {
  constructor(private readonly settings: ISystemSettingsRepository) {}

  async execute(input: SetRetentionWindowInput): Promise<Result<RetentionTargetKey>> {
    if (!input.isAdmin) {
      return err(domainError("FORBIDDEN", "Only an admin can change retention windows."));
    }
    if (!RETENTION_TARGET_KEYS.includes(input.key)) {
      return err(domainError("VALIDATION_FAILED", "Unknown retention target."));
    }
    if (!Number.isInteger(input.retentionDays) || input.retentionDays < 0) {
      return err(
        domainError("VALIDATION_FAILED", "A retention window is a whole number of days, or 0 to keep forever."),
      );
    }

    const written = await this.settings.set(
      retentionSettingKey(input.key),
      String(input.retentionDays),
    );
    if (written.error) return err(written.error);

    return ok(input.key);
  }
}
