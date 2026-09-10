import type { MessageRole } from "@wayfinder/domain";
import {
  toModelMessages,
  type ModelMessage,
} from "@/app/api/chat/[sessionId]/stream/model-messages";

// The turn that asks for the routing decision. Also the reason this helper
// exists: the branch choice is made *after* the assistant has spoken, so the
// stored transcript ends on an assistant turn. Anthropic reads a trailing
// assistant message as a prefill to continue and rejects the call outright
// ("This model does not support assistant message prefill"), which surfaced as
// the operator being asked to pick a branch by hand on every forked step.
export const BRANCH_CHOICE_REQUEST =
  "Based on the conversation above, which branch should the workflow take next? Reply with the chosen node id.";

/**
 * The transcript as the branch-choice call may receive it: stored `system` rows
 * folded into marked user notes (`toModelMessages`), then closed with the
 * request itself so the conversation always ends on a user turn.
 *
 * The streaming turn does not need this — it appends the operator's new message
 * before choosing — but the confirmation and scheduled paths both decide with
 * the assistant's message last.
 */
export const toBranchChoiceMessages = (
  rows: readonly { role: MessageRole; content: string }[],
): ModelMessage[] => [
  ...toModelMessages(rows),
  { role: "user", content: BRANCH_CHOICE_REQUEST },
];
