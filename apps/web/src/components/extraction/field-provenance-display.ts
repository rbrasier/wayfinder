import {
  aggregateConfidenceByKind,
  confidenceBand,
  fieldConfidence,
  type AggregateConfidence,
  type ConfidenceBand,
  type ConfidenceKind,
  type FieldProvenance,
} from "@rbrasier/domain";
import type { ResultFieldValue } from "./result-grid-model";

// How provenance reads on screen, as a decision separate from the markup that
// renders it. The copy describes Wayfinder's own handling only — a verbatim
// value is one Wayfinder did not change, which says nothing about whether the
// source itself is right (ADR-053 §5).
export interface ProvenanceStyle {
  label: string;
  description: string;
  className: string;
}

const STYLES: Record<FieldProvenance, ProvenanceStyle> = {
  verbatim: {
    label: "Copied",
    description: "Taken from the source unchanged. Wayfinder did not alter this value.",
    className: "border-[#bfd6e3] bg-[#eff6fa] text-[#215a77]",
  },
  processed: {
    label: "Composed",
    description: "Read and composed by the AI from the source material.",
    className: "border-[#e4ded2] bg-[#f7f5f0] text-[#5c574c]",
  },
  derived: {
    label: "Calculated",
    description: "Calculated from other fields on this record.",
    className: "border-[#d9cfe8] bg-[#f5f1fa] text-[#5a417f]",
  },
  human_corrected: {
    label: "Corrected",
    description: "Set by a person, and authoritative over anything the AI produced.",
    className: "border-[#bfe3d2] bg-[#eef8f3] text-[#1f6b4d]",
  },
};

export const provenanceStyle = (provenance: FieldProvenance): ProvenanceStyle => STYLES[provenance];

export const fieldProvenanceStyle = (field: ResultFieldValue): ProvenanceStyle =>
  provenanceStyle(fieldConfidence(field).provenance);

const KIND_LABEL: Record<ConfidenceKind, string> = {
  selection: "Selection confidence",
  accuracy: "Accuracy confidence",
};

// The number in front of an operator answers a different question depending on
// how the value was reached, so the label says which one.
export const confidenceMetricLabel = (field: ResultFieldValue): string =>
  KIND_LABEL[fieldConfidence(field).kind];

export const derivationSummary = (field: ResultFieldValue): string | null => {
  if (!field.derivation) return null;
  const { method, sourceKeys } = field.derivation;
  return sourceKeys.length > 0 ? `${method} (from ${sourceKeys.join(", ")})` : method;
};

export const sourceRefSummary = (
  field: ResultFieldValue,
  filenamesByDocumentId: Map<string, string>,
): string | null => {
  if (!field.sourceRef) return null;
  const { documentId, locator } = field.sourceRef;
  return `${filenamesByDocumentId.get(documentId) ?? documentId} — ${locator}`;
};

export interface AggregateSummary {
  kind: ConfidenceKind;
  text: string;
}

// One line per scale the record actually has. A scale it has no fields of is
// omitted rather than rendered as 0%, which would read as "nothing here is
// trustworthy" for a record that simply has no fields of that kind.
export const aggregateConfidenceSummaries = (record: {
  fields: ResultFieldValue[];
}): AggregateSummary[] => {
  const aggregate = aggregateConfidenceByKind(record);
  const summaries: AggregateSummary[] = [];
  if (aggregate.accuracy !== null) {
    summaries.push({
      kind: "accuracy",
      text: `${Math.round(aggregate.accuracy * 100)}% overall accuracy confidence`,
    });
  }
  if (aggregate.selection !== null) {
    summaries.push({
      kind: "selection",
      text: `${Math.round(aggregate.selection * 100)}% overall selection confidence`,
    });
  }
  return summaries;
};

// The report has one dot per row, so it reports the scale that carries the most
// review risk: accuracy where the record has any accuracy-kind field, selection
// only for a record that is entirely verbatim. The kind travels with the band so
// the dot can say which question it answered.
export const reportBandSource = (
  aggregate: AggregateConfidence,
): { band: ConfidenceBand; kind: ConfidenceKind } | null => {
  if (aggregate.accuracy !== null) {
    return { band: confidenceBand(aggregate.accuracy), kind: "accuracy" };
  }
  if (aggregate.selection !== null) {
    return { band: confidenceBand(aggregate.selection), kind: "selection" };
  }
  return null;
};
