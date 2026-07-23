// Retention (scaling wall #9). The unbounded-growth tables are swept on a slow
// cadence: rows older than a per-table window are deleted so the hot-path
// indexes stay lean as the tables grow. Windows are operator-configured; a
// zero (or negative) window means "keep forever", so audit and conversation
// history are never pruned unless an operator explicitly opts in.

export type RetentionTargetKey =
  | "ai_usage_events"
  | "app_session_messages"
  | "core_audit_log"
  | "app_error_log"
  | "app_notification_log"
  | "app_extraction_runs";

// Fixed iteration order so a sweep run is deterministic and the render tests can
// assert a stable shape.
export const RETENTION_TARGET_KEYS: readonly RetentionTargetKey[] = [
  "ai_usage_events",
  "app_session_messages",
  "core_audit_log",
  "app_error_log",
  "app_notification_log",
  "app_extraction_runs",
] as const;

export interface RetentionPolicy {
  readonly key: RetentionTargetKey;
  readonly label: string;
  // Rows older than this many days are eligible for deletion. Zero or negative
  // disables the sweep for this target.
  readonly retentionDays: number;
}

export interface RetentionConfig {
  readonly aiUsageEventsDays: number;
  readonly appSessionMessagesDays: number;
  readonly coreAuditLogDays: number;
  readonly appErrorLogDays: number;
  readonly appNotificationLogDays: number;
  readonly appExtractionRunsDays: number;
}

const LABELS: Record<RetentionTargetKey, string> = {
  ai_usage_events: "AI usage events",
  app_session_messages: "Session messages",
  core_audit_log: "Audit log",
  app_error_log: "Error log",
  app_notification_log: "Notification log",
  app_extraction_runs: "Extraction runs",
};

export const buildRetentionPolicies = (config: RetentionConfig): RetentionPolicy[] => {
  const daysByKey: Record<RetentionTargetKey, number> = {
    ai_usage_events: config.aiUsageEventsDays,
    app_session_messages: config.appSessionMessagesDays,
    core_audit_log: config.coreAuditLogDays,
    app_error_log: config.appErrorLogDays,
    app_notification_log: config.appNotificationLogDays,
    app_extraction_runs: config.appExtractionRunsDays,
  };
  return RETENTION_TARGET_KEYS.map((key) => ({
    key,
    label: LABELS[key],
    retentionDays: daysByKey[key],
  }));
};

export const isRetentionEnabled = (policy: RetentionPolicy): boolean => policy.retentionDays > 0;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export const retentionCutoff = (policy: RetentionPolicy, now: Date): Date =>
  new Date(now.getTime() - policy.retentionDays * MILLISECONDS_PER_DAY);
