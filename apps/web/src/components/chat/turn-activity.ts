import { messageTextSegments, type SegmentedMessage } from "./message-segments";

// What the chat says beside its typing dots while the AI works. A turn that
// consults MCP tools can take several seconds longer, and bare dots for that
// long read as stuck — so the wait names what it is waiting on.

const THINKING_LABEL = "Thinking…";

// "ParlView", "ParlView and Hansard", "ParlView, Hansard and APH".
export const describeToolSources = (sources: readonly string[]): string => {
  if (sources.length === 0) return "tools";
  if (sources.length === 1) return sources[0]!;
  return `${sources.slice(0, -1).join(", ")} and ${sources.at(-1)!}`;
};

export const consultingLabel = (sources: readonly string[]): string =>
  `Consulting ${describeToolSources(sources)}…`;

// The servers a streamed turn is consulting right now, from the latest
// `consulting-tools` annotation, or null when no lookup is running.
export const resolveConsultingSources = (annotations: readonly unknown[] | undefined): string[] | null => {
  let sources: string[] | null = null;
  for (const annotation of annotations ?? []) {
    if (typeof annotation !== "object" || annotation === null) continue;
    const record = annotation as Record<string, unknown>;
    if (record["type"] !== "consulting-tools") continue;
    const named = Array.isArray(record["sources"])
      ? record["sources"].filter((source): source is string => typeof source === "string")
      : [];
    sources = record["active"] === false ? null : named;
  }
  return sources;
};

export const resolveTurnActivityLabel = (annotations: readonly unknown[] | undefined): string => {
  const sources = resolveConsultingSources(annotations);
  return sources ? consultingLabel(sources) : THINKING_LABEL;
};

// The turn is under way but has nothing to show yet: its reply has not arrived,
// or only its status annotations have. The typing row stands in until text does.
export const awaitingFirstText = (latest: (SegmentedMessage & { role: string }) | undefined): boolean =>
  latest?.role !== "assistant" || messageTextSegments(latest).every((segment) => segment.length === 0);
