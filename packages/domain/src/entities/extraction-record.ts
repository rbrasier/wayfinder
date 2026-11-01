import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import {
  clampConfidence,
  confidenceKind,
  fieldProvenance,
  type ConfidenceKind,
  type FieldDerivation,
  type FieldProvenance,
  type FieldSourceRef,
} from "./field-provenance";

// Red/Amber/Green triage bands for extraction confidence. Confidence is a
// weakly-calibrated self-assessment (phase §5), so bands are a triage signal,
// not a gate — the UI says as much.
export type ConfidenceBand = "red" | "amber" | "green";

// Below AMBER → red; below GREEN → amber; at or above GREEN → green.
export const AMBER_THRESHOLD = 0.5;
export const GREEN_THRESHOLD = 0.8;

// A value the model is barely confident in is far more likely to be a
// hallucination than a genuine extraction, so anything below this floor is
// discarded (blanked) rather than surfaced as data. Deliberately low — it only
// removes near-guesses, leaving the red/amber bands to triage the rest. Tune
// here; it is the single source of truth for the "only extract real data" guard.
export const EXTRACTION_CONFIDENCE_FLOOR = 0.25;

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
  // How the value came to exist (ADR-053). Optional, and absent reads as
  // `processed` through `fieldProvenance` — every historical row was produced by
  // the composing path, so nothing changes meaning and nothing is back-filled.
  provenance?: FieldProvenance;
  // Where the value was read from, at field level. `ExtractionRecord.sourceDocumentIds`
  // only reaches record level.
  sourceRef?: FieldSourceRef;
  // Present on a `derived` value: the documented method and the field keys it
  // read. Recorded, never evaluated (ADR-053 §4).
  derivation?: FieldDerivation;
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

// Aggregates split by scale (ADR-053 §3). A single minimum across both kinds
// would let "how sure am I I picked the right one" win over "how sure am I this
// is right" purely by being the smaller number — not a conservative aggregate,
// a meaningless one. `null` means the record has no fields of that kind, which
// is different from — and must never be rendered as — zero.
export interface AggregateConfidence {
  selection: number | null;
  accuracy: number | null;
}

export interface ConfidenceBands {
  selection: ConfidenceBand | null;
  accuracy: ConfidenceBand | null;
}

// Reads `fields` alone, so the adapter can aggregate the fields it is about to
// persist without assembling a whole record.
type FieldBearing = { fields: ExtractionFieldResult[] };

// Within one kind the aggregate keeps the existing conservative minimum — a
// record is only as reliable as its least-confident field — so triage behaviour
// is unchanged for every record whose fields are all of one kind.
const lowestOfKind = (fields: ExtractionFieldResult[], kind: ConfidenceKind): number | null => {
  const ofKind = fields.filter((field) => confidenceKind(fieldProvenance(field)) === kind);
  if (ofKind.length === 0) return null;
  return ofKind.reduce((lowest, field) => Math.min(lowest, clampConfidence(field.confidence)), 1);
};

export const aggregateConfidenceByKind = (record: FieldBearing): AggregateConfidence => ({
  selection: lowestOfKind(record.fields, "selection"),
  accuracy: lowestOfKind(record.fields, "accuracy"),
});

export const recordConfidenceBands = (record: FieldBearing): ConfidenceBands => {
  const aggregate = aggregateConfidenceByKind(record);
  return {
    selection: aggregate.selection === null ? null : confidenceBand(aggregate.selection),
    accuracy: aggregate.accuracy === null ? null : confidenceBand(aggregate.accuracy),
  };
};

// Guards against the model surfacing an ungrounded guess as a real value. A
// field whose confidence falls below the floor is treated as absent — its value
// is cleared and its confidence zeroed, with the reason folded into the
// rationale so the operator can still see what the model attempted. An already
// blank value is returned untouched. Pure and per-field so it is trivially
// testable and reused by every extraction path.
export const applyConfidenceFloor = (
  result: ExtractionFieldResult,
  floor: number = EXTRACTION_CONFIDENCE_FLOOR,
): ExtractionFieldResult => {
  if (result.value.trim().length === 0) return result;
  if (clampConfidence(result.confidence) >= floor) return result;
  const reason = "Discarded: confidence below the reliable-extraction threshold, so no value was recorded.";
  const rationale = result.rationale.trim().length > 0 ? `${result.rationale.trim()} ${reason}` : reason;
  return { ...result, value: "", confidence: 0, rationale };
};

// Under many-per-record a record draws on several documents, each extracted on
// its own worker task (phase §5). Their field results are merged into the one
// record by keeping, per field key, the best-supported answer. Incoming keys not
// yet present are added.
//
// Three rules, in order, because a bare `confidence >` comparison is wrong twice
// over:
//
// 1. A human correction is authoritative (ADR-024) and carries `confidence: 1`,
//    so an equally-confident model value would otherwise displace it.
// 2. A copied value and a composed one carry confidences on different scales —
//    "did I pick the right one" against "is this right at all" — and ADR-053 §3
//    forbids ranking one against the other. Grounding arbitrates instead: a
//    value present byte-identically in a source document beats one composed over
//    it. The cost is stated plainly: a modestly-confident copy now beats a
//    highly-confident composition. That is the trade ADR-053 already makes, and
//    a copy only reaches this point having cleared `applyConfidenceFloor`.
// 3. Within one scale the higher confidence wins, exactly as before — so a
//    record whose fields are all of one kind merges as it always did.
const outranks = (
  candidate: ExtractionFieldResult,
  incumbent: ExtractionFieldResult,
): boolean => {
  const candidateProvenance = fieldProvenance(candidate);
  const incumbentProvenance = fieldProvenance(incumbent);
  if (candidateProvenance === "human_corrected") return true;
  if (incumbentProvenance === "human_corrected") return false;

  const candidateKind = confidenceKind(candidateProvenance);
  const incumbentKind = confidenceKind(incumbentProvenance);
  if (candidateKind !== incumbentKind) return candidateKind === "selection";

  return candidate.confidence > incumbent.confidence;
};

export const mergeFieldResults = (
  existing: ExtractionFieldResult[],
  incoming: ExtractionFieldResult[],
): ExtractionFieldResult[] => {
  const merged = new Map(existing.map((field) => [field.key, field]));
  for (const field of incoming) {
    const current = merged.get(field.key);
    if (!current || outranks(field, current)) merged.set(field.key, field);
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
// its rationale records who corrected it. The `human_corrected` provenance is
// what makes that decision machine-readable — before ADR-053 the rationale
// string carried it as prose that nothing could filter, style or export on.
// Returns a new record (pure) plus the before/after change for the audit trail.
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
  const fields = record.fields.map((field) => {
    if (field.key !== fieldKey) return field;
    // The derivation and source reference described the value that was there
    // before. A person has replaced it, so neither still describes anything —
    // keeping them would have the UI and every export claim a calculation and a
    // locator for a value that has neither.
    const { derivation: _derivation, sourceRef: _sourceRef, ...retained } = field;
    return {
      ...retained,
      value: newValue,
      confidence: 1,
      rationale: `Manually corrected${editorNote}.`,
      provenance: "human_corrected" as const,
    };
  });

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
