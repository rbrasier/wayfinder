import { describe, expect, it, vi } from "vitest";
import { ok, RETENTION_TARGET_KEYS, type ISystemSettingsRepository, type RetentionConfig } from "@rbrasier/domain";
import {
  GetRetentionSettings,
  KEEP_FOREVER,
  SetRetentionWindow,
  retentionSettingKey,
} from "./retention-settings";

const envFallback: RetentionConfig = {
  aiUsageEventsDays: KEEP_FOREVER,
  appSessionMessagesDays: KEEP_FOREVER,
  coreAuditLogDays: KEEP_FOREVER,
  appErrorLogDays: KEEP_FOREVER,
  appNotificationLogDays: KEEP_FOREVER,
  appExtractionRunsDays: KEEP_FOREVER,
  aiFlowObservationsDays: KEEP_FOREVER,
};

const settingsReturning = (stored: Record<string, string>): ISystemSettingsRepository =>
  ({
    get: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(ok(stored[key] === undefined ? null : { key, value: stored[key] })),
    ),
    set: vi.fn().mockImplementation((key: string, value: string) =>
      Promise.resolve(ok({ key, value })),
    ),
  }) as unknown as ISystemSettingsRepository;

const windowFor = (policies: { key: string; retentionDays: number }[], key: string) =>
  policies.find((policy) => policy.key === key)?.retentionDays;

describe("GetRetentionSettings", () => {
  it("returns one policy per target, including flow observations", async () => {
    const result = await new GetRetentionSettings(settingsReturning({})).execute(envFallback);

    expect(result.data?.map((policy) => policy.key)).toEqual(RETENTION_TARGET_KEYS);
  });

  it("defaults every target to keep forever", async () => {
    // Upgrading into this release must never start deleting something a
    // deployment was keeping.
    const result = await new GetRetentionSettings(settingsReturning({})).execute(envFallback);

    for (const policy of result.data!) {
      expect(policy.retentionDays).toBe(KEEP_FOREVER);
    }
  });

  it("lets a stored window override the env fallback", async () => {
    const settings = settingsReturning({ [retentionSettingKey("app_error_log")]: "30" });

    const result = await new GetRetentionSettings(settings).execute(envFallback);

    expect(windowFor(result.data!, "app_error_log")).toBe(30);
  });

  it("honours an env-set window when the key is unset", async () => {
    const result = await new GetRetentionSettings(settingsReturning({})).execute({
      ...envFallback,
      aiUsageEventsDays: 400,
    });

    expect(windowFor(result.data!, "ai_usage_events")).toBe(400);
  });

  it("ignores a stored value that is not a whole number of days", async () => {
    const settings = settingsReturning({ [retentionSettingKey("app_error_log")]: "soon" });

    const result = await new GetRetentionSettings(settings).execute({
      ...envFallback,
      appErrorLogDays: 90,
    });

    expect(windowFor(result.data!, "app_error_log")).toBe(90);
  });

  it("ignores a negative stored window", async () => {
    const settings = settingsReturning({ [retentionSettingKey("app_error_log")]: "-5" });

    const result = await new GetRetentionSettings(settings).execute(envFallback);

    expect(windowFor(result.data!, "app_error_log")).toBe(KEEP_FOREVER);
  });
});

describe("SetRetentionWindow", () => {
  it("stores a window for an admin", async () => {
    const settings = settingsReturning({});

    const result = await new SetRetentionWindow(settings).execute({
      key: "ai_flow_observations",
      retentionDays: 90,
      isAdmin: true,
    });

    expect(result.data).toBe("ai_flow_observations");
    expect(settings.set).toHaveBeenCalledWith(retentionSettingKey("ai_flow_observations"), "90");
  });

  it("accepts zero, which means keep forever", async () => {
    const settings = settingsReturning({});

    const result = await new SetRetentionWindow(settings).execute({
      key: "app_error_log",
      retentionDays: 0,
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
    expect(settings.set).toHaveBeenCalledWith(retentionSettingKey("app_error_log"), "0");
  });

  it("refuses a non-admin", async () => {
    const settings = settingsReturning({});

    const result = await new SetRetentionWindow(settings).execute({
      key: "app_error_log",
      retentionDays: 30,
      isAdmin: false,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(settings.set).not.toHaveBeenCalled();
  });

  it("refuses a negative window", async () => {
    const result = await new SetRetentionWindow(settingsReturning({})).execute({
      key: "app_error_log",
      retentionDays: -1,
      isAdmin: true,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("refuses a target that is not on the allowlist", async () => {
    const result = await new SetRetentionWindow(settingsReturning({})).execute({
      key: "app_sessions" as never,
      retentionDays: 30,
      isAdmin: true,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
