import { describe, expect, it } from "vitest";
import type {
  ExtractionDraftDocument,
  ExtractionPromptBudget,
  ExtractionSchema,
  FlowContextDoc,
} from "@wayfinder/domain";
import { estimateRunFit } from "./estimate-run-fit";

const schema = (overrides: { generateSummary?: boolean; contextDocs?: FlowContextDoc[]; cardinality?: "one_per_file" | "many_per_record" } = {}): ExtractionSchema => ({
  fields: [
    {
      field: { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
      instruction: "The supplier's legal name.",
      doneWhen: null,
    },
  ],
  input: {
    cardinality: overrides.cardinality ?? "one_per_file",
    selectionCriteria: overrides.cardinality === "many_per_record" ? "by folder" : null,
    guidance: "",
  },
  output: {
    format: "xlsx",
    outputTemplate: null,
    instruction: "",
    generateSummary: overrides.generateSummary ?? false,
    summaryTemplate: null,
    contextDocs: overrides.contextDocs ?? [],
  },
});

const draft = (id: string, textLength: number | null): ExtractionDraftDocument => ({
  id,
  flowId: "flow-1",
  filename: `${id}.txt`,
  treePath: `${id}.txt`,
  storageKey: `k/${id}`,
  mimeType: "text/plain",
  textLength,
});

const contextDoc = (chars: number): FlowContextDoc => ({
  id: "ctx-1",
  filename: "manual.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
  storagePath: "ctx/manual.pdf",
  extractedText: "p".repeat(chars),
  extractionStatus: "complete",
});

const budget: ExtractionPromptBudget = {
  contextBudgetChars: 400_000,
  maxPromptTokens: 30_000,
  contextWindowTokens: 1_000_000,
};

describe("estimateRunFit", () => {
  it("reports nothing when every document fits one call", () => {
    const estimate = estimateRunFit({
      schema: schema(),
      documents: [draft("a", 1_000), draft("b", 5_000)],
      budget,
      summaryRecordCap: 50,
    });

    expect(estimate).toEqual({
      blocking: false,
      documentsToSplit: [],
      unknownSizeCount: 0,
      contextTruncated: false,
      summaryCoverage: null,
    });
  });

  it("lists documents that will be read in parts, with roughly how many", () => {
    const estimate = estimateRunFit({
      schema: schema(),
      documents: [draft("small", 1_000), draft("feed", 300_000)],
      budget,
      summaryRecordCap: 50,
    });

    expect(estimate.blocking).toBe(false);
    expect(estimate.documentsToSplit).toHaveLength(1);
    expect(estimate.documentsToSplit[0]).toMatchObject({ documentId: "feed", filename: "feed.txt" });
    // ~300k chars against ~110k chars of room per call.
    expect(estimate.documentsToSplit[0]!.parts).toBeGreaterThanOrEqual(3);
  });

  it("counts documents whose size is unknown", () => {
    const estimate = estimateRunFit({
      schema: schema(),
      documents: [draft("old", null), draft("new", 10)],
      budget,
      summaryRecordCap: 50,
    });

    expect(estimate.unknownSizeCount).toBe(1);
  });

  it("blocks when the instructions and context material leave no room for documents", () => {
    const estimate = estimateRunFit({
      schema: schema({ contextDocs: [contextDoc(200_000)] }),
      documents: [draft("a", 10)],
      budget,
      summaryRecordCap: 50,
    });

    expect(estimate.blocking).toBe(true);
    expect(estimate.documentsToSplit).toEqual([]);
  });

  it("flags context material longer than the extraction budget", () => {
    const estimate = estimateRunFit({
      schema: schema({ contextDocs: [contextDoc(5_000)] }),
      documents: [draft("a", 10)],
      budget: { ...budget, contextBudgetChars: 1_000 },
      summaryRecordCap: 50,
    });

    expect(estimate.contextTruncated).toBe(true);
    expect(estimate.blocking).toBe(false);
  });

  it("warns that the summary will cover only some records when one record is one file", () => {
    const documents = Array.from({ length: 60 }, (_, index) => draft(`d${index}`, 10));

    const withSummary = estimateRunFit({ schema: schema({ generateSummary: true }), documents, budget, summaryRecordCap: 50 });
    expect(withSummary.summaryCoverage).toEqual({ read: 50, total: 60 });

    const noSummary = estimateRunFit({ schema: schema(), documents, budget, summaryRecordCap: 50 });
    expect(noSummary.summaryCoverage).toBeNull();
  });

  it("makes no record-count claim when files are grouped into records, since the grouping is not known yet", () => {
    const documents = Array.from({ length: 60 }, (_, index) => draft(`d${index}`, 10));

    const estimate = estimateRunFit({
      schema: schema({ generateSummary: true, cardinality: "many_per_record" }),
      documents,
      budget,
      summaryRecordCap: 50,
    });

    expect(estimate.summaryCoverage).toBeNull();
  });
});
