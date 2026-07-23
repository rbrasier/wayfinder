import { describe, expect, it } from "vitest";
import { parseTemplateField, type ExtractionSchema } from "@rbrasier/domain";
import {
  deriveOutputMode,
  emptyExtractionField,
  extractionFieldToAnnotation,
  extractionFieldToDraft,
  schemaToFieldModels,
  templateFieldToModel,
  type ExtractionFieldModel,
} from "./extraction-editor-model";

const model = (patch: Partial<ExtractionFieldModel>): ExtractionFieldModel => ({
  ...emptyExtractionField(),
  ...patch,
});

describe("extractionFieldToAnnotation", () => {
  it("serialises a plain text field to just its label", () => {
    expect(extractionFieldToAnnotation(model({ label: "Supplier Name", type: "text" }))).toBe(
      "Supplier Name",
    );
  });

  it("encodes the type and configuration into the annotation line", () => {
    const line = extractionFieldToAnnotation(model({ label: "Contract Value", type: "currency" }));
    const parsed = parseTemplateField(line);
    expect(parsed.error).toBeUndefined();
    expect(parsed.data?.type).toBe("currency");
  });

  it("round-trips a multi-select with choices", () => {
    const line = extractionFieldToAnnotation(
      model({ label: "Regions", type: "multiselect", options: ["North", "South"] }),
    );
    const parsed = parseTemplateField(line);
    expect(parsed.data?.options).toEqual(["North", "South"]);
    expect(parsed.data?.multiple).toBe(true);
  });

  it("yields an empty line for a blank label so the parser skips it", () => {
    expect(extractionFieldToAnnotation(model({ label: "  " }))).toBe("");
  });
});

describe("extractionFieldToDraft", () => {
  it("falls back to the label when no instruction is given", () => {
    const draft = extractionFieldToDraft(model({ label: "Supplier Name", instruction: "" }));
    expect(draft.instruction).toBe("Supplier Name");
  });

  it("keeps an explicit instruction", () => {
    const draft = extractionFieldToDraft(
      model({ label: "Supplier Name", instruction: "The legal entity name" }),
    );
    expect(draft.instruction).toBe("The legal entity name");
  });
});

describe("templateFieldToModel", () => {
  it("marks derived fields locked and carries the instruction", () => {
    const field = parseTemplateField("Deadline (date)").data;
    if (!field) throw new Error("expected a parsed field");
    const built = templateFieldToModel(field, { instruction: "when responses close", locked: true });
    expect(built.type).toBe("date");
    expect(built.locked).toBe(true);
    expect(built.instruction).toBe("when responses close");
  });
});

describe("deriveOutputMode", () => {
  const baseSchema = (): ExtractionSchema => ({
    fields: [],
    input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "" },
    output: {
      format: "xlsx",
      outputTemplate: null,
      instruction: "",
      generateSummary: false,
      summaryTemplate: null,
      contextDocs: [],
    },
  });

  it("defaults to structured when no template is set", () => {
    expect(deriveOutputMode(baseSchema())).toBe("structured");
    expect(deriveOutputMode(null)).toBe("structured");
  });

  it("is template when an output template is present", () => {
    const schema = baseSchema();
    schema.output.outputTemplate = {
      id: "doc-1",
      filename: "grid.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 10,
      storagePath: "extraction-templates/x",
      extractedText: "Supplier",
      extractionStatus: "complete",
    };
    expect(deriveOutputMode(schema)).toBe("template");
  });
});

describe("schemaToFieldModels", () => {
  it("seeds a single blank row for an empty schema", () => {
    expect(schemaToFieldModels(null, false)).toHaveLength(1);
    expect(schemaToFieldModels(null, false)[0]?.label).toBe("");
  });
});
