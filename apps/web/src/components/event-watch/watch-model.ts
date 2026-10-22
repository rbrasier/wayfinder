import {
  readJsonPath,
  type EventWatch,
  type WatchApiKeyPlacement,
  type WatchAuthType,
  type WatchCondition,
  type WatchHttpMethod,
  type WatchInputMapping,
  type WatchPausedReason,
} from "@rbrasier/domain";

export type JsonRowKind = "object" | "array" | "value" | "more";

export interface JsonTreeRow {
  path: string;
  label: string;
  depth: number;
  kind: JsonRowKind;
  preview: string;
}

// A list shows its first few entries: enough to pick a path from, short enough
// to scan.
const LIST_ENTRIES_SHOWN = 3;
const PREVIEW_LENGTH = 60;

const previewOf = (value: unknown): string => {
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${value.length} items`;
  if (value !== null && typeof value === "object") return "";
  const text = JSON.stringify(value) ?? "null";
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text;
};

const kindOf = (value: unknown): JsonRowKind => {
  if (Array.isArray(value)) return "array";
  return value !== null && typeof value === "object" ? "object" : "value";
};

const childPath = (parent: string, key: string): string => (parent === "" ? key : `${parent}.${key}`);

const appendChildren = (rows: JsonTreeRow[], value: unknown, path: string, depth: number): void => {
  if (Array.isArray(value)) {
    value.slice(0, LIST_ENTRIES_SHOWN).forEach((entry, index) => {
      appendRow(rows, entry, `${path}[${index}]`, `[${index}]`, depth);
    });
    if (value.length > LIST_ENTRIES_SHOWN) {
      rows.push({ path, label: "…", depth, kind: "more", preview: `${value.length - LIST_ENTRIES_SHOWN} more` });
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) appendRow(rows, entry, childPath(path, key), key, depth);
};

const appendRow = (rows: JsonTreeRow[], value: unknown, path: string, label: string, depth: number): void => {
  rows.push({ path, label, depth, kind: kindOf(value), preview: previewOf(value) });
  appendChildren(rows, value, path, depth + 1);
};

// The sample response as the rows of the field picker, auto-node style.
export const jsonTreeRows = (value: unknown): JsonTreeRow[] => {
  if (value === null || typeof value !== "object") {
    return [{ path: "", label: "(response)", depth: 0, kind: "value", preview: previewOf(value) }];
  }
  const rows: JsonTreeRow[] = [];
  appendChildren(rows, value, "", 0);
  return rows;
};

// What item-relative paths (ID, condition field, inputs) are picked from.
export const firstItemOf = (sample: unknown, itemsPath: string): unknown => {
  if (itemsPath.trim() === "") return sample;
  const items = readJsonPath(sample, itemsPath);
  return Array.isArray(items) ? items[0] : undefined;
};

const OPERATOR_WORDS: Record<Extract<WatchCondition, { kind: "matches" }>["operator"], string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  regex: "matches the pattern",
};

export const describeCondition = (condition: WatchCondition): string => {
  if (condition.kind === "new_item") return "a new item appears";
  if (condition.kind === "changed") return `${condition.fieldPath} changes`;
  if (condition.kind === "matches") {
    return `${condition.fieldPath} ${OPERATOR_WORDS[condition.operator]} ${condition.value}`;
  }
  const from = condition.from === null ? "" : ` from ${condition.from}`;
  return `${condition.fieldPath} changes${from} to ${condition.to}`;
};

const PAUSED_REASON_LABELS: Record<WatchPausedReason, string> = {
  failure_threshold: "Paused after repeated failures",
  run_cap_exceeded: "Paused: too many items matched at once",
  run_as_unavailable: "Paused: the run-as person is unavailable",
  flow_unavailable: "Paused: the flow is no longer published",
  manual: "Paused by an admin",
};

export const pausedReasonLabel = (reason: WatchPausedReason | null): string =>
  reason ? PAUSED_REASON_LABELS[reason] : "Paused";

// The editor's form: as the input the router takes, but the request body is
// the text the admin typed.
export interface WatchForm {
  name: string;
  url: string;
  method: WatchHttpMethod;
  requestBody: string;
  authType: WatchAuthType;
  apiKeyPlacement: WatchApiKeyPlacement | null;
  intervalMinutes: number;
  itemsPath: string;
  itemIdPath: string;
  condition: WatchCondition;
  fireOncePerItem: boolean;
  maxRunsPerPoll: number;
  failureThreshold: number;
  flowId: string;
  inputMapping: WatchInputMapping;
  runAsUserId: string;
}

export type WatchInput = Omit<WatchForm, "requestBody"> & { requestBody: unknown };

export const emptyWatchForm = (): WatchForm => ({
  name: "",
  url: "",
  method: "GET",
  requestBody: "",
  authType: "none",
  apiKeyPlacement: null,
  intervalMinutes: 5,
  itemsPath: "",
  itemIdPath: "",
  condition: { kind: "transition", fieldPath: "", from: null, to: "" },
  fireOncePerItem: true,
  maxRunsPerPoll: 20,
  failureThreshold: 5,
  flowId: "",
  inputMapping: {},
  runAsUserId: "",
});

export const formFromWatch = (watch: EventWatch): WatchForm => ({
  name: watch.name,
  url: watch.url,
  method: watch.method,
  requestBody: watch.requestBody === null || watch.requestBody === undefined ? "" : JSON.stringify(watch.requestBody, null, 2),
  authType: watch.authType,
  apiKeyPlacement: watch.apiKeyPlacement,
  intervalMinutes: watch.intervalMinutes,
  itemsPath: watch.itemsPath,
  itemIdPath: watch.itemIdPath,
  condition: watch.condition,
  fireOncePerItem: watch.fireOncePerItem,
  maxRunsPerPoll: watch.maxRunsPerPoll,
  failureThreshold: watch.failureThreshold,
  flowId: watch.flowId,
  inputMapping: watch.inputMapping,
  runAsUserId: watch.runAsUserId,
});

const parseBody = (text: string): { data: unknown } | { error: string } => {
  if (text.trim() === "") return { data: null };
  try {
    return { data: JSON.parse(text) as unknown };
  } catch {
    return { error: "The request body is not valid JSON." };
  }
};

export const watchInputFromForm = (form: WatchForm): { data: WatchInput; error?: never } | { error: string; data?: never } => {
  const body = form.method === "POST" ? parseBody(form.requestBody) : { data: null };
  if ("error" in body) return { error: body.error };
  return { data: { ...form, requestBody: body.data } };
};
