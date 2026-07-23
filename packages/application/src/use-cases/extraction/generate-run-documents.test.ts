import { describe, expect, it, vi } from "vitest";
import {
  ok,
  type ExtractionOutputConfig,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowContextDoc,
  type FlowVersion,
  type GenerateInput,
  type Result,
} from "@rbrasier/domain";
import { GenerateRunDocuments } from "./generate-run-documents";

const contextDoc = (overrides: Partial<FlowContextDoc> = {}): FlowContextDoc => ({
  id: "tmpl-1",
  filename: "template.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  sizeBytes: 100,
  storagePath: "templates/template.docx",
  extractedText: null,
  extractionStatus: "complete",
  ...overrides,
});

const baseRun: ExtractionRun = {
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-1",
  initiatedByUserId: "user-1",
  mode: "full",
  status: "complete",
  previewBoundary: 0,
  totalCount: 3,
  doneCount: 2,
  failedCount: 1,
  unreadableCount: 0,
  costUsd: 1,
};

const records: ExtractionRecord[] = [
  {
    id: "rec-1",
    label: "Acme",
    fields: [{ key: "supplier", value: "Acme Ltd", confidence: 0.9, rationale: "" }],
    sourceDocumentIds: ["doc-1"],
  },
  {
    id: "rec-2",
    label: "Globex",
    fields: [{ key: "supplier", value: "", confidence: 0.2, rationale: "" }],
    sourceDocumentIds: ["doc-2"],
  },
];

const buildSchema = (output: Partial<ExtractionOutputConfig>): ExtractionSchema => ({
  fields: [
    { field: { key: "supplier", label: "Supplier", type: "text", optional: false, raw: "" }, instruction: "", doneWhen: null },
  ],
  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "" },
  output: {
    format: "docx",
    outputTemplate: null,
    instruction: "",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
    ...output,
  },
});

const buildDeps = (output: Partial<ExtractionOutputConfig>, run: ExtractionRun = baseRun) => {
  const stored: Array<{ key: string; data: Buffer; mime: string }> = [];
  const runs = {
    getRun: vi.fn(async (): Promise<Result<ExtractionRun>> => ok(run)),
    listRecords: vi.fn(async (): Promise<Result<ExtractionRecord[]>> => ok(records)),
  };
  const flowVersions = {
    getById: vi.fn(async (): Promise<Result<FlowVersion | null>> =>
      ok({
        id: "version-1",
        snapshot: { kind: "extraction", metadata: {}, nodes: [], edges: [], extraction: buildSchema(output) },
      } as unknown as FlowVersion),
    ),
  };
  const generateCalls: GenerateInput[] = [];
  const documentGenerator = {
    generate: vi.fn((input: GenerateInput) => {
      generateCalls.push(input);
      return ok({ bytes: Buffer.from("doc-bytes") });
    }),
  };
  const storage = {
    get: vi.fn(async () => ok(Buffer.from("template-bytes"))),
    put: vi.fn(async (key: string, data: Buffer, mime: string) => {
      stored.push({ key, data, mime });
      return ok({ key });
    }),
  };
  const languageModel = {
    generateText: vi.fn(async () => ok({ text: "A concise narrative.", usage: {} })),
  };
  const auditLogger = { log: vi.fn(async () => ok(true as const)) };

  return {
    stored,
    generateCalls,
    runs,
    documentGenerator,
    storage,
    languageModel,
    auditLogger,
    useCase: new GenerateRunDocuments(
      runs as never,
      flowVersions as never,
      documentGenerator as never,
      storage as never,
      languageModel as never,
      auditLogger as never,
    ),
  };
};

describe("GenerateRunDocuments", () => {
  it("renders the canonical document by binding records to the repeat-group key", async () => {
    const deps = buildDeps({ outputTemplate: contextDoc() });
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 0 });

    expect(result.error).toBeUndefined();
    expect(result.data!.documentKey).toBe(
      "extraction-runs/run-1/outputs/document.docx",
    );
    const boundData = deps.generateCalls[0]!.data as { records: Array<Record<string, string>> };
    expect(boundData.records).toEqual([
      { record: "Acme", supplier: "Acme Ltd" },
      { record: "Globex", supplier: "" },
    ]);
  });

  it("skips the canonical document when no output template is configured", async () => {
    const deps = buildDeps({ outputTemplate: null });
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 0 });

    expect(result.data!.documentKey).toBeNull();
    expect(deps.documentGenerator.generate).not.toHaveBeenCalled();
  });

  it("produces a markdown summary with counts and per-field completeness when configured", async () => {
    const deps = buildDeps({ generateSummary: true });
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 0 });

    expect(result.data!.summaryMarkdownKey).toBe("extraction-runs/run-1/outputs/summary.md");
    const summary = deps.stored.find((entry) => entry.key.endsWith("summary.md"))!.data.toString("utf8");
    expect(summary).toContain("2 of 3");
    expect(summary).toContain("1 exception");
    // One of two records has a non-empty supplier value.
    expect(summary).toContain("Supplier");
    expect(summary).toContain("1/2");
    expect(summary).toContain("A concise narrative.");
  });

  it("respects the run cost ceiling: no AI narrative when the run has reached it", async () => {
    const run = { ...baseRun, costUsd: 5 };
    const deps = buildDeps({ generateSummary: true }, run);
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 5 });

    expect(deps.languageModel.generateText).not.toHaveBeenCalled();
    // The aggregate summary is still produced without the narrative.
    expect(result.data!.summaryMarkdownKey).toBe("extraction-runs/run-1/outputs/summary.md");
    const summary = deps.stored.find((entry) => entry.key.endsWith("summary.md"))!.data.toString("utf8");
    expect(summary).not.toContain("A concise narrative.");
  });

  it("renders a summary document when a summary template is provided", async () => {
    const deps = buildDeps({ generateSummary: true, summaryTemplate: contextDoc({ filename: "summary.docx" }) });
    const result = await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 0 });

    expect(result.data!.summaryDocumentKey).toBe("extraction-runs/run-1/outputs/summary.docx");
    expect(deps.stored.some((entry) => entry.key.endsWith("summary.docx"))).toBe(true);
  });

  it("writes a documents_generated audit event", async () => {
    const deps = buildDeps({ outputTemplate: contextDoc(), generateSummary: true });
    await deps.useCase.execute({ runId: "run-1", userId: "user-1", costCeilingUsd: 0 });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "extraction_run.documents_generated",
        resourceType: "extraction_run",
        resourceId: "run-1",
      }),
    );
  });
});
