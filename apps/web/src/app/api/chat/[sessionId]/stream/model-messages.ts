import type { MessageRole } from "@wayfinder/domain";

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

// Marks a stored system row so the model can tell a recorded event from
// something the user said. Matches the bracketed convention the attachment
// annotation already uses on the user turn.
const SYSTEM_NOTE_PREFIX = "[System note]";

// The transcript as the model may receive it. Stored `system` rows — the
// cross-check notes, automated and scheduled step results, quota messages, the
// approver-edit announcement — are events recorded mid-conversation, and handing
// them to the SDK with their role intact throws
// `'Multiple system messages that are separated by user/assistant messages'`.
// The role is the problem, not the content: these rows carry outcomes the next
// turn has to reason over, so they are folded into the conversation as marked
// notes rather than dropped.
//
// The genuine system prompt is passed separately and is unaffected.
export const toModelMessages = (
  rows: readonly { role: MessageRole; content: string }[],
): ModelMessage[] =>
  rows.map((row) =>
    row.role === "system"
      ? { role: "user" as const, content: `${SYSTEM_NOTE_PREFIX} ${row.content}` }
      : { role: row.role, content: row.content },
  );
