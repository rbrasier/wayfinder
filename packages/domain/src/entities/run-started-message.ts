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

const asText = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

export const runStartedInsights = (
  declared: readonly TriggerInput[],
  inputs: Record<string, unknown>,
): { key: string; value: string }[] =>
  declared
    .filter((input) => inputs[input.key] !== undefined && inputs[input.key] !== null)
    .map((input) => ({ key: input.label.trim() || input.key, value: asText(inputs[input.key]) }));
