import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  ExtractionRun,
  ExtractionSchema,
  FlowSnapshot,
  FlowVersion,
  IArchiveExtractor,
  IAuditLogger,
  IDocumentExtractor,
  IExtractionRunRepository,
  IFlowVersionRepository,
  ILanguageModel,
  IObjectStorage,
} from "@rbrasier/domain";
import { StartBatchRun } from "./start-batch-run";

const schema: ExtractionSchema = {
  fields: [
    {
      field: { key: "vendor", label: "Vendor", type: "text", optional: false, raw: "Vendor" },
      instruction: "The vendor name.",
      doneWhen: null,
    },
  ],
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

const draftSnapshot: FlowSnapshot = {
  kind: "extraction",
  flow: { name: "Tenders", description: null, icon: null, expertRole: null, contextDocs: [] },
  nodes: [],
  edges: [],
  extraction: schema,
};

const draftVersion = { id: "version-draft", snapshot: draftSnapshot } as unknown as FlowVersion;

const run = (overrides: Partial<ExtractionRun> = {}): ExtractionRun => ({
  id: "run-1",
  flowId: "flow-1",
  flowVersionId: "version-draft",
  initiatedByUserId: "user-1",
  mode: "sample",
  status: "running",
  previewBoundary: 3,
  totalCount: 4,
  doneCount: 0,
  failedCount: 0,
  unreadableCount: 0,
  costUsd: 0,
  ...overrides,
});

const makeRuns = (createRun = vi.fn().mockResolvedValue(ok(run()))) =>
  ({
    createRun,
    addDocuments: vi.fn().mockResolvedValue(
      ok([
        { id: "d1", runId: "run-1", recordId: null, filename: "a.pdf", treePath: "a.pdf", storageKey: "k1", mimeType: "application/pdf", status: "pending", attempts: 0, error: null },
      ]),
    ),
    seedRecords: vi.fn().mockResolvedValue(ok([])),
    getRun: vi.fn().mockResolvedValue(ok(run())),
  }) as unknown as IExtractionRunRepository;

const promotedVersion = {
  id: "version-draft",
  versionNumber: 3,
  snapshot: draftSnapshot,
  changeSummary: null,
} as unknown as FlowVersion;

const publishedVersion = { id: "version-published", snapshot: draftSnapshot } as unknown as FlowVersion;

const makeVersions = (
  openDraft = vi.fn().mockResolvedValue(ok(draftVersion)),
  latestPublished = vi.fn().mockResolvedValue(ok(null)),
  createPublished = vi.fn().mockResolvedValue(ok(promotedVersion)),
) =>
  ({
    openDraft,
    latestPublished,
    createPublished,
    getById: vi.fn(),
  }) as unknown as IFlowVersionRepository;

const makeAuditLogger = (log = vi.fn().mockResolvedValue(ok(true))) =>
  ({ log }) as unknown as IAuditLogger;

const storage = { put: vi.fn().mockResolvedValue(ok({ key: "k" })), get: vi.fn(), delete: vi.fn() } as unknown as IObjectStorage;
const archive = { expand: vi.fn() } as unknown as IArchiveExtractor;
const model = {} as unknown as ILanguageModel;
const extractor = {} as unknown as IDocumentExtractor;

const files = [
  { filename: "a.pdf", treePath: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("a") },
];

describe("StartBatchRun.startSample", () => {
  it("runs against the open draft version with a sample-bounded preview breakpoint", async () => {
    const createRun = vi.fn().mockResolvedValue(ok(run()));
    const runs = makeRuns(createRun);
    const useCase = new StartBatchRun(makeVersions(), runs, storage, archive, model, extractor, makeAuditLogger());

    const result = await useCase.startSample({ flowId: "flow-1", userId: "user-1", files, sampleSize: 3 });

    expect(result.error).toBeUndefined();
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        flowVersionId: "version-draft",
        mode: "sample",
        // min(sampleSize=3, files.length=1) → 1
        previewBoundary: 1,
      }),
    );
  });

  it("refuses to sample when no draft schema is configured", async () => {
    const versions = makeVersions(vi.fn().mockResolvedValue(ok(null)));
    const useCase = new StartBatchRun(versions, makeRuns(), storage, archive, model, extractor, makeAuditLogger());

    const result = await useCase.startSample({ flowId: "flow-1", userId: "user-1", files });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requires at least one input document", async () => {
    const useCase = new StartBatchRun(makeVersions(), makeRuns(), storage, archive, model, extractor, makeAuditLogger());
    const result = await useCase.startSample({ flowId: "flow-1", userId: "user-1", files: [] });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("propagates a run-creation failure", async () => {
    const runs = makeRuns(vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "db down"))));
    const useCase = new StartBatchRun(makeVersions(), runs, storage, archive, model, extractor, makeAuditLogger());
    const result = await useCase.startSample({ flowId: "flow-1", userId: "user-1", files });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("StartBatchRun.execute — version resolution", () => {
  const fullInput = { flowId: "flow-1", userId: "user-1", files, archives: [] };

  it("promotes the open draft to a published version and pins the run to it", async () => {
    const createPublished = vi.fn().mockResolvedValue(ok(promotedVersion));
    const versions = makeVersions(undefined, undefined, createPublished);
    const log = vi.fn().mockResolvedValue(ok(true));
    const createRun = vi.fn().mockResolvedValue(ok(run({ mode: "full" })));
    const useCase = new StartBatchRun(versions, makeRuns(createRun), storage, archive, model, extractor, makeAuditLogger(log));

    const result = await useCase.execute(fullInput);

    expect(result.error).toBeUndefined();
    expect(createPublished).toHaveBeenCalledWith({
      flowId: "flow-1",
      snapshot: draftSnapshot,
      publishedByUserId: "user-1",
      changeSummary: null,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "flow.version.published",
        resourceType: "flow",
        resourceId: "flow-1",
        metadata: expect.objectContaining({ versionId: "version-draft", versionNumber: 3, trigger: "batch_run" }),
      }),
    );
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({ flowVersionId: "version-draft", mode: "full" }),
    );
  });

  it("reuses the latest published version when nothing was saved since, minting none", async () => {
    const createPublished = vi.fn();
    const versions = makeVersions(
      vi.fn().mockResolvedValue(ok(null)),
      vi.fn().mockResolvedValue(ok(publishedVersion)),
      createPublished,
    );
    const log = vi.fn();
    const createRun = vi.fn().mockResolvedValue(ok(run({ mode: "full" })));
    const useCase = new StartBatchRun(versions, makeRuns(createRun), storage, archive, model, extractor, makeAuditLogger(log));

    const result = await useCase.execute(fullInput);

    expect(result.error).toBeUndefined();
    expect(createPublished).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledWith(expect.objectContaining({ flowVersionId: "version-published" }));
  });

  it("refuses a full run when there is neither a saved draft nor a published version", async () => {
    const versions = makeVersions(vi.fn().mockResolvedValue(ok(null)));
    const createRun = vi.fn();
    const useCase = new StartBatchRun(versions, makeRuns(createRun), storage, archive, model, extractor, makeAuditLogger());

    const result = await useCase.execute(fullInput);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Save the synthesis");
    expect(createRun).not.toHaveBeenCalled();
  });

  it("does not mint a version when the intake is rejected", async () => {
    const createPublished = vi.fn();
    const versions = makeVersions(undefined, undefined, createPublished);
    const useCase = new StartBatchRun(versions, makeRuns(), storage, archive, model, extractor, makeAuditLogger(), {
      maxFiles: 1,
    });

    const tooMany = await useCase.execute({ ...fullInput, files: [...files, ...files] });
    const none = await useCase.execute({ ...fullInput, files: [] });

    expect(tooMany.error?.code).toBe("VALIDATION_FAILED");
    expect(none.error?.code).toBe("VALIDATION_FAILED");
    expect(createPublished).not.toHaveBeenCalled();
  });

  it("propagates a promotion failure without creating a run", async () => {
    const versions = makeVersions(
      undefined,
      undefined,
      vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "db down"))),
    );
    const createRun = vi.fn();
    const useCase = new StartBatchRun(versions, makeRuns(createRun), storage, archive, model, extractor, makeAuditLogger());

    const result = await useCase.execute(fullInput);

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(createRun).not.toHaveBeenCalled();
  });
});
