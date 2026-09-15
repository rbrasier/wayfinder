import {
  approvalCommentSlotKey,
  type Approval,
  type IApprovalRepository,
  type TemplateField,
} from "@wayfinder/domain";
import { ATTESTATION_TEXT_KEY, SIGNATURE_FIELD_KEY, SUBJECT_NODE_ID_KEY } from "./approval-record-keys";

// Every value on a step's template that an approval owns rather than the
// conversation: each signature slot mapped to the attestation block frozen into
// whichever approval filled it, and each approval-comment slot mapped to that
// same approval's comment. Empty for a slot nobody has decided.
//
// Read by both paths that re-render a document: the decision itself, and any
// later manual edit. An edit that rebuilt the render data without these would
// silently blank an approver's signature, so this is not an optimisation but
// the thing that keeps a signed document signed.
//
// The blocks are read from the records, never recomputed. A decided approval's
// record is frozen (ADR-045 §6); re-deriving one would re-sign on the signer's
// behalf if anything bound into the hash had changed since.
export const approvalValuesForStep = async (
  approvals: IApprovalRepository,
  sessionId: string,
  subjectNodeId: string,
  fields: readonly TemplateField[],
): Promise<Record<string, string>> => {
  const slots = fields.filter((field) => field.type === "signature").map((field) => field.key);
  const comments = fields.filter((field) => field.type === "approval_comment");
  if (slots.length === 0 && comments.length === 0) return {};

  const values: Record<string, string> = {};
  for (const slot of slots) values[slot] = "";
  for (const comment of comments) values[comment.key] = "";

  const sessionApprovals = await approvals.listBySession(sessionId);
  if (sessionApprovals.error) return values;

  // A step can be decided more than once: rejected, amended, returned and
  // approved. Every decision keeps its own row and its own frozen record, so the
  // slot must show the *latest* — a superseded block would leave a document that
  // was approved reading "Rejected by" on its face. Sorted here rather than
  // trusting the repository's order, so the rule survives a change to the query.
  const latestFirst = [...sessionApprovals.data].sort(
    (first, second) => decidedOrder(second) - decidedOrder(first),
  );

  // The comment of whichever approval filled each slot, carried out of the same
  // pass that fills the slot. Taken from the same row rather than resolved
  // separately, so the block and the comment printed beside it can never come
  // from different decisions.
  const commentBySlot: Record<string, string> = {};

  for (const approval of latestFirst) {
    if (approval.status === "pending") continue;
    if (readString(approval.recordSnapshot, SUBJECT_NODE_ID_KEY) !== subjectNodeId) continue;

    const slot = readString(approval.recordSnapshot, SIGNATURE_FIELD_KEY);
    const text = readString(approval.recordSnapshot, ATTESTATION_TEXT_KEY);
    if (!slot || !text || !(slot in values)) continue;
    if (values[slot]) continue;
    values[slot] = text;
    // The row's own comment column, written once by the pending-guarded update
    // and never again, so it is as frozen as the attestation beside it — and an
    // approval decided before comment tags existed fills one on the next render.
    commentBySlot[slot] = approval.comment ?? "";
  }

  for (const comment of comments) {
    const slot = approvalCommentSlotKey(comment);
    if (!slot) continue;
    values[comment.key] = commentBySlot[slot] ?? "";
  }

  return values;
};

// Falls back to creation for a row decided before the column carried a value, so
// an undated record sorts by when it was raised rather than to the front.
const decidedOrder = (approval: Approval): number =>
  (approval.decidedAt ?? approval.createdAt).getTime();

const readString = (snapshot: Record<string, unknown> | null, key: string): string | null => {
  const value = snapshot?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};
