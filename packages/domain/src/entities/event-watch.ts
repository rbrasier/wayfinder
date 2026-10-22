import { domainError } from "../errors/index";
import { err, ok, type Result } from "../result";

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

// The fields an admin edits, checked before a watch is saved.
export interface EventWatchDraft {
  name: string;
  url: string;
  method: WatchHttpMethod;
  authType: WatchAuthType;
  apiKeyPlacement: WatchApiKeyPlacement | null;
  // A secret is already stored, or one is being supplied with this save.
  hasSecret: boolean;
  intervalMinutes: number;
  itemsPath: string;
  itemIdPath: string;
  condition: WatchCondition;
  maxRunsPerPoll: number;
  failureThreshold: number;
  flowId: string;
  runAsUserId: string;
}

export const MIN_WATCH_INTERVAL_MINUTES = 1;
export const MAX_WATCH_INTERVAL_MINUTES = 1440;
// When the response is one object rather than a list, it is its own one item.
export const SINGLE_ITEM_ID = "response";

const SEGMENT = /([^.[\]]+)|\[(\d+)\]/g;

// Reads a dotted path with [n] indices, as the field picker writes them
// (`data.hearings[0].status`). An empty path is the value itself.
export const readJsonPath = (value: unknown, path: string): unknown => {
  if (path.trim() === "") return value;
  let current: unknown = value;
  for (const match of path.matchAll(SEGMENT)) {
    if (current === null || typeof current !== "object") return undefined;
    const index = match[2];
    if (index !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(index)];
      continue;
    }
    if (Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[match[1]!];
  }
  return current;
};

// How a value reads against what an admin typed in a condition: strings as they
// are, anything else as JSON.
const displayValue = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
};

// Strict comparison between polls, so 1 and "1" are different values.
const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const matches = (condition: Extract<WatchCondition, { kind: "matches" }>, value: unknown): boolean => {
  const text = displayValue(value);
  if (condition.operator === "equals") return text === condition.value;
  if (condition.operator === "not_equals") return text !== condition.value;
  if (condition.operator === "contains") return text.toLowerCase().includes(condition.value.toLowerCase());
  try {
    return new RegExp(condition.value).test(text);
  } catch {
    return false;
  }
};

const conditionFieldPath = (condition: WatchCondition): string | null =>
  condition.kind === "new_item" ? null : condition.fieldPath;

const meetsCondition = (condition: WatchCondition, current: unknown, previous: WatchItemState | undefined): boolean => {
  if (condition.kind === "new_item") return previous === undefined;
  const before = previous?.lastValues[condition.fieldPath];
  if (condition.kind === "changed") return previous !== undefined && !sameValue(before, current);
  if (condition.kind === "matches") {
    return matches(condition, current) && (previous === undefined || !matches(condition, before));
  }
  if (previous === undefined || sameValue(before, current)) return false;
  if (displayValue(current) !== condition.to) return false;
  return condition.from === null || displayValue(before) === condition.from;
};

// The items a poll judges: the list at the items path, or the whole response
// as one item when there is no path.
export const watchItemsOf = (response: unknown, itemsPath: string): Result<unknown[]> => {
  if (itemsPath.trim() === "") return ok([response]);
  const items = readJsonPath(response, itemsPath);
  if (!Array.isArray(items)) {
    return err(domainError("VALIDATION_FAILED", `The response has no list at ${itemsPath}.`));
  }
  return ok(items);
};

export interface WatchEvaluationInput {
  condition: WatchCondition;
  // The items to judge: the list at the watch's items path, or the one response.
  items: unknown[];
  itemIdPath: string;
  previousStates: WatchItemState[];
  // The first poll after a watch is created or its source edited: record what
  // is there now and start nothing, or every existing item would fire.
  baseline: boolean;
  fireOncePerItem: boolean;
}

export interface WatchEvaluation {
  toFire: Array<{ itemId: string; item: unknown }>;
  // What to remember for every item seen this poll. `firedAt` is the caller's
  // to stamp, and only once a run has actually started.
  nextStates: Array<{ itemId: string; lastValues: Record<string, unknown> }>;
  skippedWithoutId: number;
}

const itemIdOf = (item: unknown, itemIdPath: string): string | null => {
  if (itemIdPath.trim() === "") return SINGLE_ITEM_ID;
  const value = readJsonPath(item, itemIdPath);
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value : null;
};

// Decides which items start a run this poll (ADR-063 §4). Pure: the poller
// fetches, this judges, the poller records.
export const evaluateWatchItems = (input: WatchEvaluationInput): WatchEvaluation => {
  const previousById = new Map(input.previousStates.map((state) => [state.itemId, state]));
  const fieldPath = conditionFieldPath(input.condition);
  const evaluation: WatchEvaluation = { toFire: [], nextStates: [], skippedWithoutId: 0 };

  for (const item of input.items) {
    const itemId = itemIdOf(item, input.itemIdPath);
    if (itemId === null) {
      evaluation.skippedWithoutId += 1;
      continue;
    }
    const current = fieldPath === null ? undefined : readJsonPath(item, fieldPath);
    evaluation.nextStates.push({ itemId, lastValues: fieldPath === null ? {} : { [fieldPath]: current } });

    if (input.baseline) continue;
    const previous = previousById.get(itemId);
    if (input.fireOncePerItem && previous?.firedAt) continue;
    if (meetsCondition(input.condition, current, previous)) evaluation.toFire.push({ itemId, item });
  }
  return evaluation;
};

// The editor's "would fire now" preview (ADR-063 §2): judges a sample as if
// every item had just arrived in its current state, so an admin sees which
// items the condition picks out without waiting for a real change.
export const previewWatchItems = (input: {
  condition: WatchCondition;
  items: unknown[];
  itemIdPath: string;
}): { wouldFire: Array<{ itemId: string; item: unknown }>; skippedWithoutId: number } => {
  const fieldPath = conditionFieldPath(input.condition);
  const preview = { wouldFire: [] as Array<{ itemId: string; item: unknown }>, skippedWithoutId: 0 };
  for (const item of input.items) {
    const itemId = itemIdOf(item, input.itemIdPath);
    if (itemId === null) {
      preview.skippedWithoutId += 1;
      continue;
    }
    const current = fieldPath === null ? undefined : readJsonPath(item, fieldPath);
    if (isInFiringState(input.condition, current)) preview.wouldFire.push({ itemId, item });
  }
  return preview;
};

const isInFiringState = (condition: WatchCondition, current: unknown): boolean => {
  if (condition.kind === "transition") return displayValue(current) === condition.to;
  if (condition.kind === "matches") return matches(condition, current);
  return true;
};

const isBlank = (value: string | null | undefined): boolean => !value || value.trim() === "";

const conditionProblems = (condition: WatchCondition): string[] => {
  if (condition.kind === "new_item") return [];
  const problems = isBlank(condition.fieldPath) ? ["Choose the field the condition watches."] : [];
  if (condition.kind === "transition" && isBlank(condition.to)) {
    problems.push("Enter the value the field changes to.");
  }
  if (condition.kind === "matches" && condition.operator === "regex") {
    try {
      new RegExp(condition.value);
    } catch {
      problems.push("The pattern is not a valid regular expression.");
    }
  }
  return problems;
};

const connectionProblems = (draft: EventWatchDraft): string[] => {
  if (draft.authType === "none") return [];
  const problems = draft.hasSecret ? [] : ["Enter the token or key for this connection."];
  if (draft.authType === "api_key" && isBlank(draft.apiKeyPlacement?.name)) {
    problems.push("Name the header or query parameter that carries the key.");
  }
  return problems;
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const between = (value: number, low: number, high: number): boolean =>
  Number.isInteger(value) && value >= low && value <= high;

// Problems an admin must fix before a watch can be saved, in the order the
// editor shows them.
export const validateEventWatch = (draft: EventWatchDraft): string[] => [
  ...(isBlank(draft.name) ? ["Give the watch a name."] : []),
  ...(isHttpUrl(draft.url) ? [] : ["Enter an http:// or https:// address."]),
  ...(between(draft.intervalMinutes, MIN_WATCH_INTERVAL_MINUTES, MAX_WATCH_INTERVAL_MINUTES)
    ? []
    : ["Check at least every 1 minute and at most every 1,440."]),
  ...(!isBlank(draft.itemsPath) && isBlank(draft.itemIdPath) ? ["Choose the field that identifies each item."] : []),
  ...conditionProblems(draft.condition),
  ...(between(draft.failureThreshold, 1, 50) ? [] : ["Pause after between 1 and 50 failures in a row."]),
  ...(between(draft.maxRunsPerPoll, 1, 100) ? [] : ["Allow between 1 and 100 runs per check."]),
  ...connectionProblems(draft),
  ...(isBlank(draft.flowId) ? ["Choose the flow to start."] : []),
  ...(isBlank(draft.runAsUserId) ? ["Choose who the runs belong to."] : []),
];
