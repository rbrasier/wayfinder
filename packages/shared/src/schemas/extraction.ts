import { z } from "zod";

// Claude in tool mode sometimes returns a nested array or object as a JSON
// string ("fileIds": "[\"f1\"]"). Parsing it back before validation keeps one
// stringified value from rejecting the whole reply; a string that is not JSON is
// passed through untouched so the schema still rejects it.
const parseStringifiedJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

// Models do not reliably honour "a whole number 0-100": they return 87.5, a 0-1
// fraction, or a value just outside the band. Rejecting the reply over that
// discards every other field of the record, so the number is coerced instead —
// a fraction below 1 is read as a 0-1 score, then rounded and clamped. Whole
// numbers (including 1) are left alone.
const toPercentConfidence = (confidence: number): number => {
  const scaled = confidence > 0 && confidence < 1 ? confidence * 100 : confidence;
  return Math.min(100, Math.max(0, Math.round(scaled)));
};

// One scored field pulled for one record. Confidence is 0-100 (matching the
// self-assessment pattern used by turnResponseSchema / the doc-gen gate); the
// application normalises it to the domain's 0..1 band scale. The value + its
// confidence + rationale come back in the same generateObject call (ADR-033 §8).
export const extractionFieldResultSchema = z.object({
  value: z
    .string()
    .describe(
      "The extracted value, formatted to the field's required format. Empty string if the value is genuinely not present in the documents.",
    ),
  confidence: z
    .number()
    .transform(toPercentConfidence)
    .describe(
      "Confidence 0-100 that this value is correct and grounded in the source documents (0 when the value is absent).",
    ),
  rationale: z
    .string()
    .describe(
      "Brief justification: where in the documents the value came from, or why it is uncertain or missing.",
    ),
});

// The per-record extraction result: a record keyed by the schema's field keys.
export const extractionResultSchema = z.record(extractionFieldResultSchema);

// Builds an explicit object schema with one required property per field key.
// A free-form z.record lets the provider omit keys it is unsure about — the
// cause of records after the first losing every field but the most obvious one
// (only the key is required, never a non-empty value, so this adds no pressure
// to invent). Making every key required forces the model to return an entry for
// each field, blank + zero-confidence when the value is genuinely absent.
export const buildExtractionResultSchema = (
  keys: string[],
): z.ZodType<Record<string, ExtractionFieldResultData>> => {
  const tolerantField = z.preprocess(parseStringifiedJson, extractionFieldResultSchema);
  const shape = Object.fromEntries(keys.map((key) => [key, tolerantField]));
  return z.object(shape) as z.ZodType<Record<string, ExtractionFieldResultData>>;
};

// The file-to-record grouping pass output (ADR-033 §4a). Each record lists the
// ids of the files that make it up; a file may appear in several records
// (over-matching is allowed) and files in no record are exceptions.
export const fileGroupingSchema = z.object({
  records: z
    .preprocess(
      parseStringifiedJson,
      z.array(
        z.object({
          label: z
            .string()
            .describe(
              "Short label for this record — e.g. the shared filename prefix or sub-folder.",
            ),
          fileIds: z
            .preprocess(parseStringifiedJson, z.array(z.string()))
            .describe("Ids of the input files that together make up this record."),
        }),
      ),
    )
    .describe("The records the input files group into, per the selection criteria."),
});

export type ExtractionFieldResultData = z.infer<typeof extractionFieldResultSchema>;
export type ExtractionResultData = z.infer<typeof extractionResultSchema>;
export type FileGroupingData = z.infer<typeof fileGroupingSchema>;
