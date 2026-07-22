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
