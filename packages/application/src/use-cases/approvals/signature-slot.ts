import type { FlowNode, TemplateField } from "@wayfinder/domain";

// Compatibility for flows authored before v0.26.2, whose config editor showed no
// slot dropdown when the subject step's template declared exactly one signature
// and therefore never wrote `signatureFieldKey` — leaving those approvals to
// decide without signing anything (ADR-043 §5, amended).
//
// Deliberately limited to a single slot. With two or more, an unset key stays
// unset: guessing would write a named person's attestation into the wrong
// signature line on a governance document, which is worse than not signing.
export const loneSignatureSlot = (
  nodes: FlowNode[],
  subjectNodeId: string | null,
): string | null => {
  if (!subjectNodeId) return null;

  const config = (nodes.find((node) => node.id === subjectNodeId)?.config ?? {}) as {
    documentTemplateFields?: TemplateField[];
  };
  const signatures = (config.documentTemplateFields ?? []).filter(
    (templateField) => templateField.type === "signature",
  );

  return signatures.length === 1 ? signatures[0]!.key : null;
};
