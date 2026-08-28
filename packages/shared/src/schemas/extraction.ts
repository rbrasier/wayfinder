import { z } from "zod";

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
    .int()
    .min(0)
    .max(100)
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
  sourceRef: z
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
    })
    .optional()
    .describe(
      "Where this value was read from. Omit it entirely when you cannot point to a specific place; never invent one.",
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
  const shape = Object.fromEntries(keys.map((key) => [key, extractionFieldResultSchema]));
  return z.object(shape) as z.ZodType<Record<string, ExtractionFieldResultData>>;
};

// The file-to-record grouping pass output (ADR-033 §4a). Each record lists the
// ids of the files that make it up; a file may appear in several records
// (over-matching is allowed) and files in no record are exceptions.
export const fileGroupingSchema = z.object({
  records: z
    .array(
      z.object({
        label: z
          .string()
          .describe("Short label for this record — e.g. the shared filename prefix or sub-folder."),
        fileIds: z
          .array(z.string())
          .describe("Ids of the input files that together make up this record."),
      }),
    )
    .describe("The records the input files group into, per the selection criteria."),
});

export type ExtractionFieldResultData = z.infer<typeof extractionFieldResultSchema>;
export type ExtractionResultData = z.infer<typeof extractionResultSchema>;
export type FileGroupingData = z.infer<typeof fileGroupingSchema>;
