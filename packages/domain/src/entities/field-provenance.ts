// How a field's value came to exist (ADR-053 §1). `verbatim` was selected
// byte-identically from a tool result; `processed` was composed or transformed
// by the model; `derived` was calculated from other fields; `human_corrected`
// was set by a person, which outranks everything else and is why it is a
// provenance rather than a flag.
export type FieldProvenance = "verbatim" | "processed" | "derived" | "human_corrected";

// A closed set: an exhaustive switch over it fails to compile when a fifth value
// is added, forcing a new provenance to be considered everywhere it is
// displayed, exported and audited.
export const FIELD_PROVENANCES: readonly FieldProvenance[] = [
  "verbatim",
  "processed",
  "derived",
  "human_corrected",
];

// The question a confidence number answers. `selection` asks "did it pick the
// right one" — the only question that makes sense for a copied value, where the
// source is what it is. `accuracy` asks "is this right at all". The two are
// incomparable scales and are never averaged or ranked against each other.
export type ConfidenceKind = "selection" | "accuracy";

// A documented calculation, recorded rather than evaluated (ADR-053 §4). There
// is no formula language here.
export interface FieldDerivation {
  method: string;
  sourceKeys: string[];
}

// Field-level source reference, where `ExtractionRecord.sourceDocumentIds` only
// reaches record level. `locator` is whatever identifies the position inside the
// document — a page, a cell reference, a heading.
//
// `quote` is the text the model reported copying, kept alongside the locator as
// the evidence for a `verbatim` stamp: without it the stamp cannot be audited
// after the fact. Optional only because rows written before the claim was
// verified (ADR-053 §1, amended) carry a reference with no quote — a reference
// the model returns now always has one.
export interface FieldSourceRef {
  documentId: string;
  locator: string;
  quote?: string;
}

// The provenance-bearing shape every accessor here reads. Structural rather than
// `ExtractionFieldResult` so the accessors stay usable on a partial row and this
// module keeps its zero-dependency position under `ExtractionFieldResult`.
export interface ProvenancedConfidence {
  confidence: number;
  provenance?: FieldProvenance;
}

export interface FieldConfidence {
  value: number;
  kind: ConfidenceKind;
  provenance: FieldProvenance;
}

export const clampConfidence = (confidence: number): number =>
  Math.min(1, Math.max(0, confidence));

// Every historical row was produced by the composing path, so `processed` is the
// value that preserves their meaning — absent is not unknown, it is the legacy
// default (ADR-053 §1).
export const fieldProvenance = (result: { provenance?: FieldProvenance }): FieldProvenance =>
  result.provenance ?? "processed";

// Derived, never stored, so a row cannot claim verbatim provenance with an
// accuracy metric (ADR-053 §2). One function owns the mapping, so the two can
// never drift.
export const confidenceKind = (provenance: FieldProvenance): ConfidenceKind =>
  provenance === "verbatim" ? "selection" : "accuracy";

// The supported way to read a confidence. A bare `confidence` read is the bug
// ADR-053 exists to prevent: the number alone no longer means anything without
// the question it answers.
export const fieldConfidence = (result: ProvenancedConfidence): FieldConfidence => {
  const provenance = fieldProvenance(result);
  return {
    value: clampConfidence(result.confidence),
    kind: confidenceKind(provenance),
    provenance,
  };
};
