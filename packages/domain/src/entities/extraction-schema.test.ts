import { describe, expect, it } from "vitest";
import {
  buildExtractionField,
  parseExtractionSchema,
  SAMPLE_MAX_DOCUMENTS,
  PREVIEW_FILE_THRESHOLD,
  shouldPreviewByDefault,
  type ExtractionInputConfig,
  type ExtractionOutputConfig,
  type ExtractionFieldDraft,
} from "./extraction-schema";

const oneField: ExtractionFieldDraft[] = [
  { label: "Supplier Name", annotation: "Supplier Name", instruction: "The legal name of the supplier.", doneWhen: null },
];

const onePerFileInput: ExtractionInputConfig = {
  cardinality: "one_per_file",
  selectionCriteria: null,
  guidance: "Read each response document as one supplier.",
};

const output: ExtractionOutputConfig = {
  format: "xlsx",
  outputTemplate: null,
  instruction: "Produce one row per supplier.",
  generateSummary: false,
  summaryTemplate: null,
  contextDocs: [],
};

describe("buildExtractionField", () => {
  it("parses the annotation into a typed TemplateField and keeps the instruction", () => {
    const result = buildExtractionField({
      label: "Contract Value",
      annotation: "Contract Value (currency)",
      instruction: "The total contract value in GBP.",
      doneWhen: "A figure with a currency symbol is present.",
    });

    expect(result.error).toBeUndefined();
    const field = result.data!;
    expect(field.field.key).toBe("contract_value");
    expect(field.field.type).toBe("currency");
    expect(field.instruction).toBe("The total contract value in GBP.");
    expect(field.doneWhen).toBe("A figure with a currency symbol is present.");
  });

  it("rejects a field whose instruction is blank", () => {
    const result = buildExtractionField({
      label: "Supplier Name",
      annotation: "Supplier Name",
      instruction: "   ",
      doneWhen: null,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a template-annotation parse error", () => {
    const result = buildExtractionField({
      label: "Amount",
      annotation: "Amount (nonsense)",
      instruction: "The amount.",
      doneWhen: null,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("parseExtractionSchema", () => {
  it("assembles a schema from valid fields and configs", () => {
    const result = parseExtractionSchema({
      fields: oneField,
      input: onePerFileInput,
      output,
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.fields).toHaveLength(1);
    expect(result.data!.fields[0]!.field.label).toBe("Supplier Name");
  });

  it("rejects a schema with no fields", () => {
    const result = parseExtractionSchema({ fields: [], input: onePerFileInput, output });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects duplicate field keys", () => {
    const result = parseExtractionSchema({
      fields: [
        { label: "Supplier Name", annotation: "Supplier Name", instruction: "Name.", doneWhen: null },
        { label: "supplier name", annotation: "supplier name", instruction: "Also name.", doneWhen: null },
      ],
      input: onePerFileInput,
      output,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toMatch(/duplicate/i);
  });

  it("requires selection criteria when cardinality is many_per_record", () => {
    const result = parseExtractionSchema({
      fields: oneField,
      input: { cardinality: "many_per_record", selectionCriteria: "  ", guidance: "" },
      output,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toMatch(/selection criteria/i);
  });

  it("rejects selection criteria supplied for one_per_file", () => {
    const result = parseExtractionSchema({
      fields: oneField,
      input: { cardinality: "one_per_file", selectionCriteria: "all files with a prefix", guidance: "" },
      output,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("accepts many_per_record with non-empty selection criteria", () => {
    const result = parseExtractionSchema({
      fields: oneField,
      input: {
        cardinality: "many_per_record",
        selectionCriteria: "all files sharing a filename prefix",
        guidance: "Group by prefix.",
      },
      output,
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.input.cardinality).toBe("many_per_record");
  });

  it("clears the summary template when summary generation is off", () => {
    const result = parseExtractionSchema({
      fields: oneField,
      input: onePerFileInput,
      output: {
        ...output,
        generateSummary: false,
        summaryTemplate: {
          id: "doc-1",
          filename: "summary.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          sizeBytes: 10,
          storagePath: "s/1",
          extractedText: null,
          extractionStatus: "pending",
        },
      },
    });

    expect(result.error).toBeUndefined();
    expect(result.data!.output.summaryTemplate).toBeNull();
  });
});

describe("shouldPreviewByDefault", () => {
  it("is off at or below the threshold and on above it", () => {
    expect(PREVIEW_FILE_THRESHOLD).toBe(5);
    expect(shouldPreviewByDefault(5)).toBe(false);
    expect(shouldPreviewByDefault(6)).toBe(true);
    expect(shouldPreviewByDefault(0)).toBe(false);
  });

  it("caps the sample at three documents", () => {
    expect(SAMPLE_MAX_DOCUMENTS).toBe(3);
  });
});
