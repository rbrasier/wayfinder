import { describe, expect, it } from "vitest";
import { MAX_ANALYSE_DOCUMENTS, isAutoAnalyseOn, analyseDocumentCount } from "@wayfinder/domain";
import {
  adoptDraftedFields,
  outputIsConfigured,
  resolveAnalysisState,
  showsAutoAnalyseControls,
  showsManualInputQuestions,
  uploadShouldStartAnalysis,
} from "./extraction-editor-model";

const analysis = (overrides: Partial<Parameters<typeof resolveAnalysisState>[0]> = {}) => ({
  status: "running",
  totalCount: 3,
  doneCount: 0,
  unreadableCount: 0,
  ...overrides,
});

describe("resolveAnalysisState", () => {
  it("shows running while the analysis is live", () => {
    expect(resolveAnalysisState(analysis(), false)).toBe("running");
  });

  it("shows running the moment the author triggers it, before the first poll lands", () => {
    expect(resolveAnalysisState(analysis({ status: "complete" }), true)).toBe("running");
  });

  it("shows drafted when every document was read", () => {
    expect(resolveAnalysisState(analysis({ status: "complete", doneCount: 3 }), false)).toBe(
      "drafted",
    );
  });

  it("does not mention exceptions when the run lost no documents", () => {
    // A cancelled or spend-capped run settles non-complete having read every
    // document it touched; "0 documents could not be read" would be nonsense.
    const state = resolveAnalysisState(
      analysis({ status: "cancelled", doneCount: 3, unreadableCount: 0 }),
      false,
    );

    expect(state).toBe("drafted");
  });

  it("names the exceptions when some documents were read and some were not", () => {
    const state = resolveAnalysisState(
      analysis({ status: "partial", doneCount: 2, unreadableCount: 1 }),
      false,
    );

    expect(state).toBe("drafted_with_exceptions");
  });

  it("distinguishes unreadable documents from a failure to draft", () => {
    const unreadable = resolveAnalysisState(
      analysis({ status: "partial", doneCount: 0, unreadableCount: 3 }),
      false,
    );
    const failed = resolveAnalysisState(
      analysis({ status: "partial", doneCount: 0, unreadableCount: 0 }),
      false,
    );

    expect(unreadable).toBe("unreadable");
    expect(failed).toBe("failed");
  });
});

describe("auto analyse control visibility", () => {
  it("hides the whole control from a user who cannot author", () => {
    expect(showsAutoAnalyseControls(false)).toBe(false);
    expect(showsAutoAnalyseControls(true)).toBe(true);
  });

  it("never starts an analysis on upload for a user who cannot author", () => {
    expect(uploadShouldStartAnalysis(true, false)).toBe(false);
  });

  it("starts an analysis on upload only when the toggle is on", () => {
    expect(uploadShouldStartAnalysis(true, true)).toBe(true);
    expect(uploadShouldStartAnalysis(false, true)).toBe(false);
  });

  it("hides the manual questions while auto analyse is on, and restores them when off", () => {
    expect(showsManualInputQuestions(true)).toBe(false);
    expect(showsManualInputQuestions(false)).toBe(true);
  });

  it("treats the output as unconfigured until there is a field to pull", () => {
    expect(outputIsConfigured(0, true)).toBe(false);
    expect(outputIsConfigured(2, true)).toBe(true);
  });

  it("treats the output as unconfigured while a template mode has no template", () => {
    expect(outputIsConfigured(2, false)).toBe(false);
  });
});

describe("the settings the editor seeds from", () => {
  const baseInput = { cardinality: "one_per_file" as const, selectionCriteria: null, guidance: "" };

  it("defaults a brand-new synthesis to on, reading three documents", () => {
    expect(isAutoAnalyseOn(baseInput)).toBe(true);
    expect(analyseDocumentCount(baseInput)).toBe(3);
  });

  it("seeds off for a saved config that uses the manual grouping path", () => {
    expect(
      isAutoAnalyseOn({
        cardinality: "many_per_record",
        selectionCriteria: "files sharing a prefix",
        guidance: "",
      }),
    ).toBe(false);
  });

  it("offers a stepper range the server will accept", () => {
    expect(MAX_ANALYSE_DOCUMENTS).toBe(10);
    expect(analyseDocumentCount({ ...baseInput, analyseSampleSize: 10 })).toBe(10);
  });
});

// A saved schema as the editor reads it back after an analysis settles.
const savedSchema = (labels: string[]) =>
  ({
    fields: labels.map((label) => ({
      field: {
        key: label.toLowerCase().replace(/\W+/g, "_"),
        label,
        type: "text" as const,
        optional: false,
        raw: `${label} (text)`,
      },
      instruction: `Pull the ${label.toLowerCase()}.`,
      doneWhen: null,
    })),
    input: { cardinality: "one_per_file" as const, selectionCriteria: null, guidance: "" },
    output: {
      format: "xlsx" as const,
      outputTemplate: null,
      instruction: "",
      generateSummary: false,
      summaryTemplate: null,
      contextDocs: [],
    },
  }) as Parameters<typeof adoptDraftedFields>[1];

const localField = (label: string, instruction = "mine") => ({
  label,
  annotation: `${label} (text)`,
  instruction,
  locked: false,
});

describe("adoptDraftedFields", () => {
  it("brings drafted fields into an editor that was showing the empty row", () => {
    const adopted = adoptDraftedFields(
      [localField("")] as never,
      savedSchema(["Supplier Name", "Submission Date"]),
    );

    expect(adopted.map((field) => field.label)).toEqual(["Supplier Name", "Submission Date"]);
  });

  it("appends drafted fields to a schema the author already had", () => {
    const adopted = adoptDraftedFields(
      [localField("Contract Value")] as never,
      savedSchema(["Contract Value", "Supplier Name"]),
    );

    expect(adopted.map((field) => field.label)).toEqual(["Contract Value", "Supplier Name"]);
  });

  it("never replaces a field the author is editing locally", () => {
    const adopted = adoptDraftedFields(
      [localField("Supplier Name", "the author's wording")] as never,
      savedSchema(["Supplier Name"]),
    );

    expect(adopted).toHaveLength(1);
    expect(adopted[0]!.instruction).toBe("the author's wording");
  });

  it("keeps an unsaved local field the analysis knows nothing about", () => {
    const adopted = adoptDraftedFields(
      [localField("My Own Field")] as never,
      savedSchema(["Supplier Name"]),
    );

    expect(adopted.map((field) => field.label)).toEqual(["My Own Field", "Supplier Name"]);
  });

  it("changes nothing when the analysis drafted nothing new", () => {
    const current = [localField("Supplier Name")] as never;

    expect(adoptDraftedFields(current, savedSchema(["Supplier Name"]))).toBe(current);
  });

  it("changes nothing when there is no saved schema to read", () => {
    const current = [localField("Supplier Name")] as never;

    expect(adoptDraftedFields(current, null)).toBe(current);
  });
});
