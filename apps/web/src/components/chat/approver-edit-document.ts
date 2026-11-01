import type { SessionMessage } from "@wayfinder/domain";

// The document an approver-edit announcement is about. Resolved from the
// messages already loaded rather than fetched: the announcement carries the
// step it was made on, and the step's newest document is what was edited.
//
// The same rule the approver's queue applies
// (`ListApprovalsWithContext.resolvePreviousDocument`), deliberately — the
// originator's thread and the approver's queue showing different revisions of
// the same document would be worse than either showing none.
export const resolveApproverEditDocument = (
  messages: readonly SessionMessage[],
  stepNodeId: string | null,
): SessionMessage | null => {
  if (!stepNodeId) return null;

  return (
    messages
      .filter((message) => message.stepNodeId === stepNodeId && message.document)
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0] ?? null
  );
};
