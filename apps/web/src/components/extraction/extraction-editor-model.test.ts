import { describe, expect, it } from "vitest";
import { parseTemplateField, type ExtractionSchema } from "@rbrasier/domain";
import {
  deriveOutputMode,
  emptyExtractionField,
  extractionFieldToAnnotation,
  extractionFieldToDraft,
  proposalDraftsToFieldModels,
  proposalFieldSummaries,
  schemaSeedKey,
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

// The editor reads the schema once, when it mounts. Seeding it from a query that
// has not settled leaves it on the empty defaults and the next Save writes those
// defaults over the stored schema, so a pending query must never share a key
// with a settled one.
describe("schemaSeedKey", () => {
  it("distinguishes a pending query from a settled empty one", () => {
    expect(schemaSeedKey(null, true)).not.toBe(schemaSeedKey(null, false));
  });

  it("distinguishes a pending query from a settled loaded one", () => {
    const schema: ExtractionSchema = {
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
    };

    expect(schemaSeedKey(schema, true)).not.toBe(schemaSeedKey(schema, false));
  });

  it("is stable once the query has settled, so a background refetch does not reset the form", () => {
    expect(schemaSeedKey(null, false)).toBe(schemaSeedKey(null, false));
  });
});

describe("proposalDraftsToFieldModels", () => {
  it("brings confirmed drafts in as unlocked editor rows carrying their type and instruction", () => {
    const models = proposalDraftsToFieldModels([
      {
        label: "Contract Value",
        annotation: "Contract Value (currency)",
        instruction: "The total contract value.",
        doneWhen: null,
      },
    ]);

    expect(models).toEqual([
      expect.objectContaining({
        label: "Contract Value",
        type: "currency",
        instruction: "The total contract value.",
        locked: false,
      }),
    ]);
  });

  it("maps an options field to the editor's select type", () => {
    const models = proposalDraftsToFieldModels([
      {
        label: "Status",
        annotation: "Status (options: Draft, Final)",
        instruction: "The bid status.",
        doneWhen: null,
      },
    ]);

    expect(models[0]).toMatchObject({ type: "select", options: ["Draft", "Final"] });
  });

  it("skips a draft that will not parse rather than seeding a broken row", () => {
    const models = proposalDraftsToFieldModels([
      { label: "Good", annotation: "Good (text)", instruction: "Pull it.", doneWhen: null },
      { label: "Bad", annotation: "Bad (colour)", instruction: "Pull it.", doneWhen: null },
    ]);

    expect(models.map((model) => model.label)).toEqual(["Good"]);
  });

  it("falls back to one blank row when nothing parses, so the editor still renders", () => {
    const models = proposalDraftsToFieldModels([
      { label: "Bad", annotation: "Bad (colour)", instruction: "Pull it.", doneWhen: null },
    ]);

    expect(models).toHaveLength(1);
    expect(models[0]!.label).toBe("");
  });
});

describe("proposalFieldSummaries", () => {
  it("names each drafted field and its type in the words the type picker uses", () => {
    const summaries = proposalFieldSummaries([
      {
        label: "Contract Value",
        annotation: "Contract Value (currency)",
        instruction: "The total contract value.",
        doneWhen: null,
      },
      {
        label: "Signed On",
        annotation: "Signed On (date) (optional)",
        instruction: "The date the contract was signed.",
        doneWhen: null,
      },
    ]);

    expect(summaries).toEqual([
      {
        label: "Contract Value",
        typeLabel: "Currency",
        instruction: "The total contract value.",
        optional: false,
      },
      {
        label: "Signed On",
        typeLabel: "Date",
        instruction: "The date the contract was signed.",
        optional: true,
      },
    ]);
  });

  it("names an options field by the editor's select type", () => {
    const summaries = proposalFieldSummaries([
      {
        label: "Status",
        annotation: "Status (multi-options: Draft, Final)",
        instruction: "The bid status.",
        doneWhen: null,
      },
    ]);

    expect(summaries[0]!.typeLabel).toBe("Multi-select");
  });

  it("skips a draft that will not parse rather than naming a type it does not have", () => {
    const summaries = proposalFieldSummaries([
      { label: "Good", annotation: "Good (text)", instruction: "Pull it.", doneWhen: null },
      { label: "Bad", annotation: "Bad (colour)", instruction: "Pull it.", doneWhen: null },
    ]);

    expect(summaries.map((summary) => summary.label)).toEqual(["Good"]);
  });

  it("returns nothing at all when nothing parses, rather than a blank row", () => {
    const summaries = proposalFieldSummaries([
      { label: "Bad", annotation: "Bad (colour)", instruction: "Pull it.", doneWhen: null },
    ]);

    expect(summaries).toEqual([]);
  });
});
