import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { ConversationalNodeConfig } from "./flow-node";
import type { TemplateField } from "./template-field";

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
export const nodeFieldSet = (config: ConversationalNodeConfig): TemplateField[] => {
  const outputType = normaliseOutputType(config.outputType);
  if (outputType === "generate_document") return config.documentTemplateFields ?? [];
  if (outputType === "structured") return config.structuredFields ?? [];
  return [];
};

// Validates an author-declared structured field set. The `section` type is a
// document "include/omit this part" concept with no meaning when no document
// exists, so it is rejected here — client and server share this check
// (ADR-038 §5). Returns the fields unchanged on success.
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
  return ok(fields);
};
