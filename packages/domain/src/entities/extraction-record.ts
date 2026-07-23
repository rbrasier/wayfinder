import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";

// Red/Amber/Green triage bands for extraction confidence. Confidence is a
// weakly-calibrated self-assessment (phase §5), so bands are a triage signal,
// not a gate — the UI says as much.
export type ConfidenceBand = "red" | "amber" | "green";

// Below AMBER → red; below GREEN → amber; at or above GREEN → green.
export const AMBER_THRESHOLD = 0.5;
export const GREEN_THRESHOLD = 0.8;

const clampConfidence = (confidence: number): number => Math.min(1, Math.max(0, confidence));

export const confidenceBand = (confidence: number): ConfidenceBand => {
  const value = clampConfidence(confidence);
  if (value < AMBER_THRESHOLD) return "red";
  if (value < GREEN_THRESHOLD) return "amber";
  return "green";
};

// One field pulled for one record: the value, a self-assessed confidence in
// [0, 1], and a short rationale (ADR-033 §5). The confidence + rationale come
// from the same generateObject call as the value (the structured
// self-assessment pattern), scoped per field per record.
export interface ExtractionFieldResult {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
}

// One output record — the unit the schema is filled for and reviewed. Its
// sourceDocumentIds link the exact input files it drew on, powering the
// row → source-file highlighting in the viewer (ADR-033 §5).
export interface ExtractionRecord {
  id: string;
  label: string;
  fields: ExtractionFieldResult[];
  sourceDocumentIds: string[];
}

// A record is only as reliable as its least-confident field, so the aggregate
// is the minimum — the most conservative triage signal. Empty → 0 (red).
export const aggregateConfidence = (record: ExtractionRecord): number => {
  if (record.fields.length === 0) return 0;
  return record.fields.reduce(
    (lowest, field) => Math.min(lowest, clampConfidence(field.confidence)),
    1,
  );
};

export const recordConfidenceBand = (record: ExtractionRecord): ConfidenceBand =>
  confidenceBand(aggregateConfidence(record));

// Under many-per-record a record draws on several documents, each extracted on
// its own worker task (phase §5). Their field results are merged into the one
// record by keeping, per field key, the value with the highest confidence — the
// best-supported answer wins, and a later low-confidence document never
// overwrites an earlier confident one. Incoming keys not yet present are added.
export const mergeFieldResults = (
  existing: ExtractionFieldResult[],
  incoming: ExtractionFieldResult[],
): ExtractionFieldResult[] => {
  const merged = new Map(existing.map((field) => [field.key, field]));
  for (const field of incoming) {
    const current = merged.get(field.key);
    if (!current || field.confidence > current.confidence) {
      merged.set(field.key, field);
    }
  }
  return [...merged.values()];
};

// The before/after of one manual correction, carried into the audit log so the
// edit history is reconstructable without a separate versions table (phase §4).
export interface FieldEditChange {
  key: string;
  previousValue: string;
  newValue: string;
}

export interface FieldEditResult {
  record: ExtractionRecord;
  change: FieldEditChange;
}

// Applies an operator's per-field correction (phase §2.4, ADR-024). The human
// edit is authoritative: no AI re-run, the field is stamped fully confident and
// its rationale records who corrected it. Returns a new record (pure) plus the
// before/after change for the audit trail.
export const applyFieldEdit = (
  record: ExtractionRecord,
  fieldKey: string,
  newValue: string,
  editorLabel: string,
): Result<FieldEditResult> => {
  const target = record.fields.find((field) => field.key === fieldKey);
  if (!target) {
    return err(domainError("NOT_FOUND", `Record has no field "${fieldKey}" to edit.`));
  }

  const editorNote = editorLabel.trim().length > 0 ? ` by ${editorLabel.trim()}` : "";
  const fields = record.fields.map((field) =>
    field.key === fieldKey
      ? { ...field, value: newValue, confidence: 1, rationale: `Manually corrected${editorNote}.` }
      : field,
  );

  return ok({
    record: { ...record, fields },
    change: { key: fieldKey, previousValue: target.value, newValue },
  });
};

export interface FieldFillCount {
  key: string;
  filled: number;
  total: number;
}

export interface FieldCompleteness {
  perField: FieldFillCount[];
  overallFilled: number;
  overallTotal: number;
}

// Per-field completeness across a run's records — how many records carry a
// non-empty value for each schema field (phase §2.3). Feeds the summary
// document's per-field completeness aggregate. A whitespace-only value is empty.
export const fieldCompleteness = (
  records: ExtractionRecord[],
  fieldKeys: string[],
): FieldCompleteness => {
  const perField = fieldKeys.map((key) => {
    let filled = 0;
    for (const record of records) {
      const field = record.fields.find((candidate) => candidate.key === key);
      if (field && field.value.trim().length > 0) filled += 1;
    }
    return { key, filled, total: records.length };
  });

  return {
    perField,
    overallFilled: perField.reduce((sum, entry) => sum + entry.filled, 0),
    overallTotal: fieldKeys.length * records.length,
  };
};
