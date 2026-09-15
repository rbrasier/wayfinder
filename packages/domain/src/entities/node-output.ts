import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { ConversationalNodeConfig } from "./flow-node";
import { isApprovalOwnedTag, isSignatureTag, type TemplateField } from "./template-field";

// Stored in `doneWhen` when a template-backed step's completion criterion is
// "the template is filled" rather than an author-written sentence. It is a
// marker, not English: anything that reads `doneWhen` as guidance — a branch
// purpose, a retrieval query — must skip it rather than pass it on.
export const TEMPLATE_COMPLETE_SENTINEL = "__TEMPLATE_COMPLETE__";

// `doneWhen` as prose, or null when it holds the sentinel (or nothing). The one
// accessor for "is there an author-written criterion here", so a reader can
// never forget the sentinel case.
export const doneWhenGuidance = (doneWhen: string | null | undefined): string | null => {
  const trimmed = doneWhen?.trim();
  if (!trimmed || trimmed === TEMPLATE_COMPLETE_SENTINEL) return null;
  return trimmed;
};

// The three author-facing output types for a conversational step (ADR-038).
// `unstructured` is the current name for the legacy stored `conversation_only`
// value; `structured` captures author-declared fields with no document.
export type OutputType = "generate_document" | "structured" | "unstructured";

// An output-type value as it may appear in stored config: the three current
// types plus the legacy `conversation_only` string written before ADR-038.
export type StoredOutputType = OutputType | "conversation_only";

// Maps a stored output-type value to a current OutputType. Legacy
// `conversation_only` (and any unrecognised or missing value) becomes
// `unstructured`, so a pre-ADR-038 node behaves exactly as an unstructured
// conversation with no data movement.
export const normaliseOutputType = (value: string | null | undefined): OutputType => {
  if (value === "generate_document") return "generate_document";
  if (value === "structured") return "structured";
  return "unstructured";
};

// The single field-set accessor feeding extraction and the pre-generation gate.
// A template step reads its parsed `documentTemplateFields`; a structured step
// reads its author-declared `structuredFields`; anything else has no field set.
// Being the sole reader keeps the two config slots from diverging (ADR-038 §2).
//
// A `signature` field — and the `approval_comment` that quotes its approver — is
// filtered out here rather than at each call site, because every consumer must
// inherit the exclusion: the AI prompt never learns the field exists, an unsigned
// slot never blocks readiness, and manual editing cannot reach it (ADR-043 §2).
// A signature slot the conversation can reach is a signature an operator can
// forge, and a comment slot it can reach is words put in an approver's mouth.
export const nodeFieldSet = (config: ConversationalNodeConfig): TemplateField[] => {
  const outputType = normaliseOutputType(config.outputType);
  if (outputType === "generate_document") return gatherableFields(config.documentTemplateFields);
  if (outputType === "structured") return gatherableFields(config.structuredFields);
  return [];
};

// The exclusion itself, for the one caller that cannot go through
// `nodeFieldSet`: the pre-generation gate resolves a template step's fields from
// the node config *or* by extracting them from the template bytes, and the byte
// path has no config to hand. Exported rather than duplicated so there is still
// a single definition of what the conversation may gather.
//
// Rendering is the deliberate exception and must keep the raw set: a signature
// has to reach `buildRenderData` to be written — as the attestation once decided,
// as an empty string until then.
export const gatherableFields = (
  fields: TemplateField[] | null | undefined,
): TemplateField[] =>
  (fields ?? []).filter(
    (field) => field.type !== "signature" && field.type !== "approval_comment",
  );

// What a masked signature slot reads as in a template body handed to a model.
export const SIGNATURE_SLOT_MARKER =
  "[signature slot — recorded by an approval step, never gathered in conversation]";

// The same for an approval comment. Named separately rather than sharing the
// signature's wording, because the line around it reads as a question to answer
// — "Reason for decision:" — and a marker calling that a signature slot invites
// the model to argue with it.
export const APPROVAL_COMMENT_SLOT_MARKER =
  "[approval comment — recorded by an approval step, never gathered in conversation]";

const TEMPLATE_TAG_PATTERN = /\{\{([\s\S]*?)\}\}/g;

// A template line with its approval-owned tags handled, or null when the whole
// line must go.
//
// Removing the tag alone is not enough: a template introduces its slot with a
// label — "First Level Supervisor Approval:" — and a label left standing over a
// blank is exactly what the model asked the operator about. So a line whose only
// tags belong to an approval is dropped entire, label and all. A line that also
// carries a gatherable tag has to survive for that tag's sake, and there the
// approval tag becomes a marker, which the prompt's constraint then explains.
const gatherableTemplateLine = (line: string): string | null => {
  const tags = [...line.matchAll(TEMPLATE_TAG_PATTERN)];
  const approvalOwnedCount = tags.filter((tag) => isApprovalOwnedTag(tag[1] ?? "")).length;
  if (approvalOwnedCount === 0) return line;
  if (approvalOwnedCount === tags.length) return null;

  return line.replace(TEMPLATE_TAG_PATTERN, (tag, body: string) => {
    if (isSignatureTag(body)) return SIGNATURE_SLOT_MARKER;
    return isApprovalOwnedTag(body) ? APPROVAL_COMMENT_SLOT_MARKER : tag;
  });
};

// `gatherableFields` for the template *body*. A template step's prose reaches
// the gathering model twice over — verbatim in the session prompt's
// <document_template> block, and as retrieved chunks once indexed — and neither
// path carries a field set, so neither inherits the field filter. The body still
// spells out `{{ Supervisor Signature (approval) }}` under an instruction to
// gather everything needed to complete the template, which is enough on its own
// for the model to ask the operator for a signature (ADR-043 §2).
//
// Null when nothing gatherable is left, so a template of signatures alone
// produces no template block and no indexed chunk at all, rather than a body of
// markers.
//
// Rendering is the same deliberate exception it is for fields: `buildRenderData`
// reads the raw body, because the tag must survive to be substituted.
export const gatherableTemplateContent = (
  content: string | null | undefined,
): string | null => {
  if (!content) return null;

  const gatherable = content
    .split("\n")
    .map(gatherableTemplateLine)
    .filter((line): line is string => line !== null)
    .join("\n");

  return gatherable.trim().length > 0 ? gatherable : null;
};

// Validates an author-declared structured field set. The `section` type is a
// document "include/omit this part" concept with no meaning when no document
// exists, so it is rejected here — client and server share this check
// (ADR-038 §5). A `signature` is rejected for the same reason: no document, no
// signature (ADR-043 §2), and an `approval_comment` follows the signature it
// belongs to. Returns the fields unchanged on success.
export const validateStructuredFieldSet = (fields: TemplateField[]): Result<TemplateField[]> => {
  const section = fields.find((field) => field.type === "section");
  if (section) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${section.label}" uses the section type, which is only available for document templates. Remove it from this structured step.`,
      ),
    );
  }
  const signature = fields.find((field) => field.type === "signature");
  if (signature) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${signature.label}" is an approval signature, which is only available for document templates. Remove it from this structured step.`,
      ),
    );
  }
  const approvalComment = fields.find((field) => field.type === "approval_comment");
  if (approvalComment) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `"${approvalComment.label}" is an approval comment, which is only available for document templates. Remove it from this structured step.`,
      ),
    );
  }
  return ok(fields);
};
