import { describe, expect, it } from "vitest";
import { ok, err, domainError, type ExtractionFieldDraft, type ExtractionRun } from "@wayfinder/domain";
import { ProposeExtractionFields } from "./propose-extraction-fields";

const analysisRun = (overrides: Partial<ExtractionRun> = {}): ExtractionRun => ({
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: null,
  initiatedByUserId: "user-1",
  mode: "analyse",
  status: "running",
  previewBoundary: 0,
  totalCount: 3,
  doneCount: 0,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
  ...overrides,
});

const stagedDocument = (name: string) => ({
  id: `doc-${name}`,
  flowId: "flow-1",
  filename: `${name}.docx`,
  treePath: `${name}.docx`,
  storageKey: `key-${name}`,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
});

const proposal = (label: string): ExtractionFieldDraft => ({
  label,
  annotation: `${label} (text)`,
  instruction: `Pull the ${label.toLowerCase()}.`,
  doneWhen: null,
});

// Records what the analysis settled with, which is the assertion most of these
// tests make, and what it wrote, which is the one that must not happen on failure.
const buildHarness = (options: {
  staged?: ReturnType<typeof stagedDocument>[];
  unreadableKeys?: string[];
  missingKeys?: string[];
  proposed?: ExtractionFieldDraft[] | "error";
  existingFields?: ExtractionFieldDraft[];
  saveFails?: boolean;
} = {}) => {
  const staged = options.staged ?? [stagedDocument("a"), stagedDocument("b")];
  const settled: { status: string; documentsRead: number; documentsUnreadable: number }[] = [];
  const saved: ExtractionFieldDraft[][] = [];
  const readKeys: string[] = [];

  const runs = {
    settleAnalysisRun: async (_id: string, outcome: never) => {
      settled.push(outcome);
      return ok(analysisRun({ status: (outcome as { status: string }).status as never }));
    },
  };

  const drafts = { listForFlow: async () => ok(staged) };

  const flowVersions = {
    openDraft: async () =>
      ok(
        options.existingFields
          ? {
              id: "version-1",
              snapshot: {
                kind: "extraction" as const,
                extraction: {
                  fields: options.existingFields.map((field) => ({
                    field: { key: field.label.toLowerCase().replace(/\W+/g, "_"), label: field.label, type: "text", optional: false, raw: field.annotation },
                    instruction: field.instruction,
                    doneWhen: field.doneWhen,
                  })),
                  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "", autoAnalyse: true, analyseSampleSize: 2 },
                  output: { format: "xlsx", outputTemplate: null, instruction: "", generateSummary: false, summaryTemplate: null, contextDocs: [] },
                },
              },
            }
          : null,
      ),
  };

  const storage = {
    get: async (key: string) => {
      readKeys.push(key);
      if (options.missingKeys?.includes(key)) return err(domainError("NOT_FOUND", "gone"));
      return ok(Buffer.from("bytes"));
    },
  };

  const extractor = {
    extract: async ({ buffer }: { buffer: Buffer }) => {
      void buffer;
      const key = readKeys[readKeys.length - 1];
      if (options.unreadableKeys?.includes(key)) return err(domainError("VALIDATION_FAILED", "scanned"));
      return ok("Supplier: Acme. Submitted 1 March.");
    },
  };

  const proposer = {
    propose: async () =>
      options.proposed === "error"
        ? err(domainError("VALIDATION_FAILED", "model refused"))
        : ok(options.proposed ?? [proposal("Supplier Name")]),
  };

  const saveExtractionSchema = {
    execute: async ({ schema }: { schema: { fields: ExtractionFieldDraft[] } }) => {
      if (options.saveFails) return err(domainError("VALIDATION_FAILED", "bad field"));
      saved.push(schema.fields);
      return ok({ id: "version-1" });
    },
  };

  const useCase = new ProposeExtractionFields(
    runs as never,
    drafts as never,
    flowVersions as never,
    saveExtractionSchema as never,
    storage as never,
    extractor as never,
    proposer as never,
  );

  return { useCase, settled, saved, readKeys };
};

describe("ProposeExtractionFields", () => {
  it("reads no more documents than the configured count, even when more are staged", async () => {
    const harness = buildHarness({
      staged: [stagedDocument("a"), stagedDocument("b"), stagedDocument("c"), stagedDocument("d")],
      existingFields: [],
    });

    await harness.useCase.execute(analysisRun());

    // The fixture's saved config sets analyseSampleSize to 2.
    expect(harness.readKeys).toEqual(["key-a", "key-b"]);
  });

  it("reads all staged documents when there are fewer than the configured count", async () => {
    const harness = buildHarness({ staged: [stagedDocument("a")], existingFields: [] });

    await harness.useCase.execute(analysisRun());

    expect(harness.readKeys).toEqual(["key-a"]);
  });

  it("drafts fields and settles complete when every document was readable", async () => {
    const harness = buildHarness();

    await harness.useCase.execute(analysisRun());

    expect(harness.settled[0]).toEqual({
      status: "complete",
      documentsRead: 2,
      documentsUnreadable: 0,
    });
    expect(harness.saved[0].map((field) => field.label)).toEqual(["Supplier Name"]);
  });

  it("continues on the readable documents and settles partial when one cannot be read", async () => {
    const harness = buildHarness({ unreadableKeys: ["key-b"] });

    await harness.useCase.execute(analysisRun());

    expect(harness.settled[0]).toEqual({
      status: "partial",
      documentsRead: 1,
      documentsUnreadable: 1,
    });
    expect(harness.saved).toHaveLength(1);
  });

  it("counts a document whose bytes are missing as unreadable", async () => {
    const harness = buildHarness({ missingKeys: ["key-a"] });

    await harness.useCase.execute(analysisRun());

    expect(harness.settled[0].documentsUnreadable).toBe(1);
  });

  it("writes nothing and settles partial when every document is unreadable", async () => {
    const harness = buildHarness({ unreadableKeys: ["key-a", "key-b"] });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved).toHaveLength(0);
    expect(harness.settled[0]).toEqual({
      status: "partial",
      documentsRead: 0,
      documentsUnreadable: 2,
    });
  });

  it("writes nothing and settles partial when the proposer errors", async () => {
    const harness = buildHarness({ proposed: "error" });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved).toHaveLength(0);
    expect(harness.settled[0].status).toBe("partial");
  });

  it("settles partial rather than complete when nothing was staged to analyse", async () => {
    const harness = buildHarness({ staged: [] });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved).toHaveLength(0);
    expect(harness.settled[0]).toEqual({
      status: "partial",
      documentsRead: 0,
      documentsUnreadable: 0,
    });
  });

  it("drops a proposed field whose annotation will not parse, keeping the rest", async () => {
    const harness = buildHarness({
      proposed: [
        proposal("Supplier Name"),
        { label: "Broken", annotation: "Broken (not-a-type)", instruction: "x", doneWhen: null },
      ],
    });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved[0].map((field) => field.label)).toEqual(["Supplier Name"]);
  });

  it("drops a proposed field with no instruction, which buildExtractionField rejects", async () => {
    const harness = buildHarness({
      proposed: [{ label: "Supplier Name", annotation: "Supplier Name (text)", instruction: "  ", doneWhen: null }],
    });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved).toHaveLength(0);
    expect(harness.settled[0].status).toBe("complete");
  });

  it("never overwrites a field the author already has", async () => {
    const harness = buildHarness({
      existingFields: [
        { label: "Supplier Name", annotation: "Supplier Name (text)", instruction: "The author's wording.", doneWhen: null },
      ],
      proposed: [proposal("Supplier Name"), proposal("Submission Date")],
    });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved[0]).toHaveLength(2);
    expect(harness.saved[0][0].instruction).toBe("The author's wording.");
    expect(harness.saved[0][1].label).toBe("Submission Date");
  });

  it("writes nothing when every proposed field already exists", async () => {
    const harness = buildHarness({
      existingFields: [
        { label: "Supplier Name", annotation: "Supplier Name (text)", instruction: "Mine.", doneWhen: null },
      ],
      proposed: [proposal("Supplier Name")],
    });

    await harness.useCase.execute(analysisRun());

    expect(harness.saved).toHaveLength(0);
    expect(harness.settled[0].status).toBe("complete");
  });

  it("reports a save failure rather than settling the run as if it had worked", async () => {
    const harness = buildHarness({ saveFails: true });

    const result = await harness.useCase.execute(analysisRun());

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(harness.settled).toHaveLength(0);
  });
});
