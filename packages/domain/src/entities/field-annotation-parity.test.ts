import { describe, expect, it } from "vitest";
import { buildExtractionField, parseExtractionSchema } from "./extraction-schema";
import { validateStructuredFieldSet } from "./node-output";
import { parseTemplateField } from "./template-field";
import type { ExtractionInputConfig, ExtractionOutputConfig } from "./extraction-schema";

// An extraction field and a conversational structured field (ADR-038
// `structuredFields`) reach the same field model down different paths, and
// nothing stopped them drifting. These cases drive both paths from one list, so
// an annotation newly accepted or rejected on one side fails here until the
// other side agrees.

const inputConfig: ExtractionInputConfig = {
  cardinality: "one_per_file",
  selectionCriteria: null,
  guidance: "Read each document.",
};

const outputConfig: ExtractionOutputConfig = {
  format: "xlsx",
  outputTemplate: null,
  instruction: "",
  generateSummary: false,
  summaryTemplate: null,
  contextDocs: [],
};

// The extraction path: annotation → buildExtractionField → parseExtractionSchema.
const extractionAccepts = (annotation: string): boolean => {
  const schema = parseExtractionSchema({
    fields: [{ label: annotation, annotation, instruction: "Pull it.", doneWhen: null }],
    input: inputConfig,
    output: outputConfig,
  });
  return schema.error === undefined;
};

// The conversational path: annotation → parseTemplateField → validateStructuredFieldSet.
const structuredAccepts = (annotation: string): boolean => {
  const field = parseTemplateField(annotation);
  if (field.error) return false;
  return validateStructuredFieldSet([field.data]).error === undefined;
};

const ACCEPTED = [
  "Supplier Name (text)",
  "Signed On (date)",
  "Contract Value (currency)",
  "Headcount (number)",
  "Contact (email)",
  "Renewed (yesno)",
  "Summary (narrative)",
  "Status (options: Draft, Final)",
  "Tags (multi-options: A, B, C)",
  "Notes (text) (maxlen: 200)",
  "Score (number) (min: 0) (max: 10)",
  "Reference (text) (optional)",
  "Plain Label",
];

const REJECTED = [
  // Unknown annotation.
  "Supplier (colour)",
  // Two types on one field. `text` is the default, so a clash needs two
  // non-default keywords — "(text) (date)" is a date field, not a conflict.
  "Supplier (date) (currency)",
  // A type combined with an options list.
  "Status (date) (options: A, B)",
  // Empty options list.
  "Status (options: )",
  // Both options and multi-options.
  "Status (options: A) (multi-options: B)",
  // Non-numeric maxlen.
  "Notes (text) (maxlen: many)",
  // Document-template-only types: a section is an include/omit directive and a
  // signature is an approval slot. Neither exists without a document.
  "Part B (section)",
  "Approver (approval)",
];

describe("extraction and structured fields accept the same annotations", () => {
  it.each(ACCEPTED)("both accept %s", (annotation) => {
    expect(structuredAccepts(annotation)).toBe(true);
    expect(extractionAccepts(annotation)).toBe(true);
  });
});

describe("extraction and structured fields reject the same annotations", () => {
  it.each(REJECTED)("both reject %s", (annotation) => {
    expect(structuredAccepts(annotation)).toBe(false);
    expect(extractionAccepts(annotation)).toBe(false);
  });
});

describe("the shared field model", () => {
  it("derives the same key for the same label down both paths", () => {
    const extraction = buildExtractionField({
      label: "Contract Value",
      annotation: "Contract Value (currency)",
      instruction: "Pull it.",
      doneWhen: null,
    });
    const structured = parseTemplateField("Contract Value (currency)");

    expect(extraction.data!.field.key).toBe(structured.data!.key);
    expect(extraction.data!.field.type).toBe(structured.data!.type);
  });
});
