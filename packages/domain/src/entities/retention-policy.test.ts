import { describe, expect, it } from "vitest";
import {
  RETENTION_TARGET_KEYS,
  buildRetentionPolicies,
  isRetentionEnabled,
  retentionCutoff,
  type RetentionConfig,
} from "./retention-policy";

const config: RetentionConfig = {
  aiUsageEventsDays: 400,
  appSessionMessagesDays: 0,
  coreAuditLogDays: 0,
  appErrorLogDays: 90,
  appNotificationLogDays: 180,
  appExtractionRunsDays: 30,
};

describe("buildRetentionPolicies", () => {
  it("builds one policy per known target, in a stable order", () => {
    const policies = buildRetentionPolicies(config);
    expect(policies.map((policy) => policy.key)).toEqual(RETENTION_TARGET_KEYS);
  });

  it("maps each configured retention window onto its target", () => {
    const policies = buildRetentionPolicies(config);
    const byKey = Object.fromEntries(policies.map((policy) => [policy.key, policy.retentionDays]));
    expect(byKey.ai_usage_events).toBe(400);
    expect(byKey.app_error_log).toBe(90);
    expect(byKey.app_notification_log).toBe(180);
    expect(byKey.core_audit_log).toBe(0);
    expect(byKey.app_session_messages).toBe(0);
    expect(byKey.app_extraction_runs).toBe(30);
  });

  it("gives every policy a human-readable label", () => {
    for (const policy of buildRetentionPolicies(config)) {
      expect(policy.label.length).toBeGreaterThan(0);
    }
  });
});

describe("isRetentionEnabled", () => {
  it("is enabled only for a positive retention window", () => {
    expect(isRetentionEnabled({ key: "app_error_log", label: "x", retentionDays: 90 })).toBe(true);
  });

  it("is disabled at zero (keep forever)", () => {
    expect(isRetentionEnabled({ key: "core_audit_log", label: "x", retentionDays: 0 })).toBe(false);
  });

  it("is disabled for a negative window (treated as keep forever)", () => {
    expect(isRetentionEnabled({ key: "core_audit_log", label: "x", retentionDays: -5 })).toBe(false);
  });
});

describe("retentionCutoff", () => {
  it("subtracts the retention window from the current instant", () => {
    const now = new Date("2026-07-04T00:00:00.000Z");
    const cutoff = retentionCutoff({ key: "app_error_log", label: "x", retentionDays: 90 }, now);
    expect(cutoff.toISOString()).toBe("2026-04-05T00:00:00.000Z");
  });

  it("returns a cutoff strictly in the past for any positive window", () => {
    const now = new Date("2026-07-04T12:00:00.000Z");
    const cutoff = retentionCutoff({ key: "ai_usage_events", label: "x", retentionDays: 1 }, now);
    expect(cutoff.getTime()).toBeLessThan(now.getTime());
  });
});
