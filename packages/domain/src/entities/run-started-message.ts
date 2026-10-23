import type { TriggerInput } from "./flow-trigger";

// The line an unattended run opens its chat with (ADR-065 §2), saying what
// started it. It carries the run's trigger inputs as gathered insights, so they
// show and travel like facts gathered in a chat. Built and parsed here, as
// `approver-edit-message.ts` is, because the feed reads it back and a format
// agreed in two places drifts.

export interface RunStartedSource {
  origin: "watch" | "webhook";
  // The watch's name; null for a webhook, which has none.
  sourceName: string | null;
}

const WATCH_PATTERN = /^Started by Event Watch "(.+)"\.$/;
const WEBHOOK_MESSAGE = "Started by a webhook.";

export const buildRunStartedMessage = (source: RunStartedSource): string =>
  source.origin === "watch" && source.sourceName
    ? `Started by Event Watch "${source.sourceName}".`
    : WEBHOOK_MESSAGE;

export const parseRunStartedMessage = (content: string): RunStartedSource | null => {
  if (content === WEBHOOK_MESSAGE) return { origin: "webhook", sourceName: null };
  const match = WATCH_PATTERN.exec(content);
  return match ? { origin: "watch", sourceName: match[1]! } : null;
};

// Prefixed to each insight the run opens with, e.g. "Event Watch · status".
export const RUN_STARTED_SOURCE_TAG: Record<RunStartedSource["origin"], string> = {
  watch: "Event Watch",
  webhook: "Webhook",
};
// Enough for a hearing's metadata; a payload bigger than this is noise in every
// later prompt, and the whole of it stays on the session for an AI task.
const MAX_ITEM_FIELDS = 50;
const MAX_VALUE_LENGTH = 500;

const asText = (value: unknown): string =>
  (typeof value === "string" ? value : JSON.stringify(value)).slice(0, MAX_VALUE_LENGTH);

const isScalar = (value: unknown): boolean => value === null || typeof value !== "object";

// The stored marker for a payload that was too large to keep (ADR-064 §2).
const isTruncatedMarker = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && (raw as { truncated?: unknown }).truncated === true;

// Every value in the item as a dotted path, e.g. `committee.name`. A list of
// plain values reads as one comma-separated value.
const itemFields = (value: unknown, path: string, fields: [string, string][]): void => {
  if (fields.length >= MAX_ITEM_FIELDS || value === null || value === undefined) return;
  if (Array.isArray(value) && value.every(isScalar)) {
    fields.push([path || "item", asText(value.join(", "))]);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => itemFields(entry, `${path}[${index}]`, fields));
    return;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) itemFields(entry, path ? `${path}.${key}` : key, fields);
    return;
  }
  fields.push([path || "item", asText(value)]);
};

// What the run's opening line records as gathered insights: the flow's declared
// inputs under their labels, then every field of what started it (the watch's
// item or the webhook's body), each tagged with its source so a reader — and
// the model — can tell them from facts gathered in the chat.
export const runStartedInsights = (input: {
  origin: RunStartedSource["origin"];
  declared: readonly TriggerInput[];
  inputs: Record<string, unknown>;
  raw: unknown;
}): { key: string; value: string }[] => {
  const tag = RUN_STARTED_SOURCE_TAG[input.origin];
  const declaredInsights = input.declared
    .filter((declared) => input.inputs[declared.key] !== undefined && input.inputs[declared.key] !== null)
    .map((declared) => ({
      key: `${tag} · ${declared.label.trim() || declared.key}`,
      value: asText(input.inputs[declared.key]),
    }));
  const fields: [string, string][] = [];
  if (!isTruncatedMarker(input.raw)) itemFields(input.raw, "", fields);
  const room = Math.max(MAX_ITEM_FIELDS - declaredInsights.length, 0);
  return [
    ...declaredInsights,
    ...fields.slice(0, room).map(([path, value]) => ({ key: `${tag} · ${path}`, value })),
  ];
};
