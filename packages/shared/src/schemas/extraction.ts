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
  // Optional by design (ADR-053 §1): a model that cannot point at a specific
  // place must still return the field. A missing reference is not an extraction
  // failure, and it is never filled in with a placeholder.
  //
  // `quote` is required *inside* the reference, so "I can point at this" and
  // "here is what I copied" are the same act. A reference without a quote could
  // never be verified, and a half-claim would only be re-interpreted downstream
  // as the containment guess this schema exists to replace.
  //
  // A model asked to omit the reference often sends `null` instead; that means
  // the same thing, so it is read as absent rather than rejecting the record.
  sourceRef: z
    .preprocess(
      (value) => (value === null ? undefined : value),
      z
        .object({
          document: z
            .string()
            .describe(
              "The source document the value was read from, named exactly as it appears in the record source documents.",
            ),
          locator: z
            .string()
            .describe(
              "Where inside that document the value sits — a page number, a section heading, a table cell reference or a line.",
            ),
          quote: z
            .string()
            .describe(
              "The exact characters copied from that document, reproduced byte for byte — same spelling, case, spacing and punctuation. It must contain the value and must appear in the document verbatim. Return a short surrounding phrase rather than paraphrasing, and omit the whole sourceRef if you composed or reformatted the value rather than copying it.",
            ),
        })
        .optional(),
    )
    .describe(
      "Where this value was read from, and the exact text it was copied from. Omit it entirely when you cannot point to a specific place, or when you composed or reformatted the value rather than copying it; never invent one.",
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

// One field Auto Analyse proposes from the input documents (ADR-059). The shape
// is the domain's ExtractionFieldDraft minus doneWhen, which the proposer does
// not invent — a completion criterion is the author's judgement, not the
// documents'.
//
// The annotation is a line in the author's own annotation language, so a
// proposed field reaches the schema through parseTemplateField like a typed one.
// The valid annotation list is not repeated here: this package cannot import
// @wayfinder/domain, so the prompt carries the list (VALID_ANNOTATIONS_HINT) and
// this schema describes only the shape.
export const fieldProposalSchema = z.object({
  fields: z
    .array(
      z.object({
        label: z
          .string()
          .min(1)
          .describe("Short human-readable field name, e.g. \"Supplier Name\"."),
        annotation: z
          .string()
          .min(1)
          .describe(
            "The field's annotation line: the label followed by its type and any modifiers in parentheses, e.g. \"Submission Date (date) (optional)\". Use only the annotations listed in the instructions.",
          ),
        instruction: z
          .string()
          .min(1)
          .describe(
            "Plain-English instruction telling the extractor what to pull for this field and where it typically sits in the documents.",
          ),
      }),
    )
    .describe(
      "The fields a person reading these documents would most likely want extracted, in the order they should appear.",
    ),
});

export type FieldProposalData = z.infer<typeof fieldProposalSchema>;
