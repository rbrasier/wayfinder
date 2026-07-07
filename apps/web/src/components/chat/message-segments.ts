// Pure resolver for how a streamed message splits into chat bubbles. One
// streamed response can carry several logical messages (the reply, then a
// cross-check follow-up or pass note) separated by finish_step boundaries, so
// each text part must render as its own bubble — matching the separate rows the
// server persists, which keeps the streamed and persisted views identical.

export interface SegmentedMessage {
  content: string;
  parts?: readonly { type: string; text?: string }[];
}

export const messageTextSegments = (message: SegmentedMessage): string[] => {
  const textParts = (message.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .filter((text) => text.length > 0);

  if (textParts.length > 0) return textParts;
  // Messages synced from the persisted history carry no parts — the whole
  // content is a single bubble.
  return [message.content];
};
