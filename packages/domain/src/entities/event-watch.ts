// An admin rule that polls an external JSON API and starts a flow run for each
// item that meets a condition (ADR-063). The watch carries its own connection;
// the secret is held encrypted by the repository and never appears here.

export type WatchHttpMethod = "GET" | "POST";

export type WatchAuthType = "none" | "bearer" | "api_key";

export interface WatchApiKeyPlacement {
  in: "header" | "query";
  name: string;
}

export type WatchMatchOperator = "equals" | "not_equals" | "contains" | "regex";

export type WatchCondition =
  // `from: null` means "from any other value".
  | { kind: "transition"; fieldPath: string; from: string | null; to: string }
  | { kind: "matches"; fieldPath: string; operator: WatchMatchOperator; value: string }
  | { kind: "new_item" }
  | { kind: "changed"; fieldPath: string };

export type EventWatchStatus = "active" | "paused";

export type WatchPausedReason =
  | "failure_threshold"
  | "run_cap_exceeded"
  | "run_as_unavailable"
  | "flow_unavailable"
  | "manual";

// Trigger-input key → item-relative JSON path that supplies it.
export type WatchInputMapping = Record<string, string>;

export interface EventWatch {
  id: string;
  name: string;
  url: string;
  method: WatchHttpMethod;
  requestBody: unknown;
  authType: WatchAuthType;
  apiKeyPlacement: WatchApiKeyPlacement | null;
  hasSecret: boolean;
  intervalMinutes: number;
  itemsPath: string;
  itemIdPath: string;
  condition: WatchCondition;
  fireOncePerItem: boolean;
  maxRunsPerPoll: number;
  flowId: string;
  inputMapping: WatchInputMapping;
  runAsUserId: string;
  status: EventWatchStatus;
  baselinePending: boolean;
  consecutiveFailures: number;
  failureThreshold: number;
  lastError: string | null;
  pausedReason: WatchPausedReason | null;
  pausedAt: Date | null;
  pauseIncidentId: string | null;
  lastPolledAt: Date | null;
  lastSuccessAt: Date | null;
  nextPollAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// The last values seen for one item, so the next poll can tell what changed.
export interface WatchItemState {
  watchId: string;
  itemId: string;
  lastValues: Record<string, unknown>;
  firedAt: Date | null;
  lastSeenAt: Date;
}
