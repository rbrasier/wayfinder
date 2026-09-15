import { describe, expect, it } from "vitest";
import { MAX_ANALYSE_DOCUMENTS, isAutoAnalyseOn, analyseDocumentCount } from "@wayfinder/domain";
import {
  resolveAnalysisState,
  runSampleBelongsInInputCard,
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

  it("moves Run sample into the input card only while auto analyse is on for an author", () => {
    expect(runSampleBelongsInInputCard(true, true)).toBe(true);
    expect(runSampleBelongsInInputCard(false, true)).toBe(false);
    expect(runSampleBelongsInInputCard(true, false)).toBe(false);
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
