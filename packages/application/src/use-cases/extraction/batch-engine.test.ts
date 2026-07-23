import { describe, expect, it } from "vitest";
import {
  domainError,
  err,
  ok,
  type ArchiveEntry,
  type ArchiveLimits,
  type CreateRunInput,
  type DocumentOutcome,
  type ExtractionDocument,
  type ExtractionFieldResult,
  type ExtractionRecord,
  type ExtractionRun,
  type ExtractionSchema,
  type FlowVersion,
  type GenerateObjectInput,
  type IArchiveExtractor,
  type IDocumentExtractor,
  type IExtractionRunRepository,
  type IFlowVersionRepository,
  type ILanguageModel,
  type IObjectStorage,
  type NewExtractionDocument,
  type NewExtractionRecord,
  type Result,
  type RunStatus,
  type RunStatusCounts,
  type TokenUsage,
} from "@rbrasier/domain";
import { AdvanceBatchRuns } from "./advance-batch-runs";
import { CancelRun } from "./cancel-run";
import { ContinueRun } from "./continue-run";
import { ProcessExtractionTask } from "./process-extraction-task";
import { RetryFailed } from "./retry-failed";
import { StartBatchRun } from "./start-batch-run";

const ZERO_USAGE: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const buildSchema = (
  overrides: Partial<ExtractionSchema["input"]> = {},
): ExtractionSchema => ({
  fields: [
    {
      field: { key: "supplier_name", label: "Supplier name", type: "text", optional: false },
      instruction: "The supplier's legal name.",
      doneWhen: null,
    },
  ],
  input: { cardinality: "one_per_file", selectionCriteria: null, guidance: "Read closely.", ...overrides },
  output: {
    format: "xlsx",
    outputTemplate: null,
    instruction: "",
    generateSummary: false,
    summaryTemplate: null,
    contextDocs: [],
  },
});

// ── In-memory repository ──────────────────────────────────────────────────────

interface StoredRecord extends ExtractionRecord {
  runId: string;
  ordinal: number;
}

class InMemoryExtractionRunRepository implements IExtractionRunRepository {
  private runs = new Map<string, ExtractionRun>();
  private documents = new Map<string, ExtractionDocument>();
  private records = new Map<string, StoredRecord>();
  private sequence = 0;

  private id(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async createRun(input: CreateRunInput): Promise<Result<ExtractionRun>> {
    const run: ExtractionRun = {
      id: this.id("run"),
      flowId: input.flowId,
      flowVersionId: input.flowVersionId,
      initiatedByUserId: input.initiatedByUserId,
      mode: input.mode,
      status: "running",
      previewBoundary: input.previewBoundary,
      totalCount: 0,
      doneCount: 0,
      failedCount: 0,
      unreadableCount: 0,
      costUsd: 0,
    };
    this.runs.set(run.id, run);
    return ok({ ...run });
  }

  async getRun(runId: string): Promise<Result<ExtractionRun>> {
    const run = this.runs.get(runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));
    return ok({ ...run });
  }

  async updateRunStatus(runId: string, status: RunStatus): Promise<Result<void>> {
    const run = this.runs.get(runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));
    run.status = status;
    return ok(undefined);
  }

  async continuePastPreview(runId: string): Promise<Result<void>> {
    const run = this.runs.get(runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));
    run.status = "running";
    run.previewBoundary = 0;
    return ok(undefined);
  }

  async addDocuments(
    runId: string,
    documents: NewExtractionDocument[],
  ): Promise<Result<ExtractionDocument[]>> {
    const run = this.runs.get(runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));
    const created = documents.map((document) => {
      const row: ExtractionDocument = {
        id: this.id("doc"),
        runId,
        recordId: null,
        filename: document.filename,
        treePath: document.treePath,
        storageKey: document.storageKey,
        mimeType: document.mimeType,
        status: "pending",
        attempts: 0,
        error: null,
      };
      this.documents.set(row.id, row);
      return { ...row };
    });
    run.totalCount += created.length;
    return ok(created);
  }

  async seedRecords(
    runId: string,
    records: NewExtractionRecord[],
  ): Promise<Result<ExtractionRecord[]>> {
    const created = records.map((record) => {
      const row: StoredRecord = {
        id: this.id("record"),
        runId,
        ordinal: record.ordinal,
        label: record.label,
        fields: [],
        sourceDocumentIds: record.sourceDocumentIds,
      };
      this.records.set(row.id, row);
      for (const documentId of record.sourceDocumentIds) {
        const document = this.documents.get(documentId);
        if (document) document.recordId = row.id;
      }
      return { id: row.id, label: row.label, fields: [], sourceDocumentIds: row.sourceDocumentIds };
    });
    return ok(created);
  }

  async listClaimableRunIds(): Promise<Result<string[]>> {
    return ok([...this.runs.values()].filter((run) => run.status === "running").map((run) => run.id));
  }

  async claimPendingDocuments(runId: string, limit: number): Promise<Result<ExtractionDocument[]>> {
    const claimed = [...this.documents.values()]
      .filter((document) => document.runId === runId && document.status === "pending")
      .slice(0, limit);
    for (const document of claimed) {
      document.status = "extracting";
      document.attempts += 1;
    }
    return ok(claimed.map((document) => ({ ...document })));
  }

  async countByStatus(runId: string): Promise<Result<RunStatusCounts>> {
    const counts: RunStatusCounts = {
      pending: 0,
      extracting: 0,
      complete: 0,
      failed: 0,
      unreadable: 0,
    };
    for (const document of this.documents.values()) {
      if (document.runId === runId) counts[document.status] += 1;
    }
    return ok(counts);
  }

  async getRecord(recordId: string): Promise<Result<ExtractionRecord | null>> {
    const record = this.records.get(recordId);
    if (!record) return ok(null);
    return ok({
      id: record.id,
      label: record.label,
      fields: record.fields.map((field) => ({ ...field })),
      sourceDocumentIds: record.sourceDocumentIds,
    });
  }

  async saveRecordFields(
    recordId: string,
    fields: ExtractionFieldResult[],
  ): Promise<Result<void>> {
    const record = this.records.get(recordId);
    if (!record) return err(domainError("NOT_FOUND", "record not found"));
    record.fields = fields;
    return ok(undefined);
  }

  async settleDocument(
    documentId: string,
    outcome: DocumentOutcome,
    costUsdDelta: number,
  ): Promise<Result<ExtractionRun>> {
    const document = this.documents.get(documentId);
    if (!document) return err(domainError("NOT_FOUND", "document not found"));
    const run = this.runs.get(document.runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));

    document.status = outcome.status;
    document.error = outcome.error;
    if (outcome.status === "complete") run.doneCount += 1;
    if (outcome.status === "failed") run.failedCount += 1;
    if (outcome.status === "unreadable") run.unreadableCount += 1;
    run.costUsd += costUsdDelta;
    return ok({ ...run });
  }

  async resetFailedToPending(runId: string): Promise<Result<number>> {
    const run = this.runs.get(runId);
    if (!run) return err(domainError("NOT_FOUND", "run not found"));
    let reset = 0;
    for (const document of this.documents.values()) {
      if (document.runId === runId && document.status === "failed") {
        document.status = "pending";
        document.attempts = 0;
        document.error = null;
        reset += 1;
      }
    }
    run.failedCount = Math.max(0, run.failedCount - reset);
    return ok(reset);
  }

  async listRunsForFlow(flowId: string): Promise<Result<ExtractionRun[]>> {
    return ok([...this.runs.values()].filter((run) => run.flowId === flowId).map((run) => ({ ...run })));
  }

  async listRecords(runId: string): Promise<Result<ExtractionRecord[]>> {
    return ok(
      [...this.records.values()]
        .filter((record) => record.runId === runId)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((record) => ({
          id: record.id,
          label: record.label,
          fields: record.fields.map((field) => ({ ...field })),
          sourceDocumentIds: record.sourceDocumentIds,
        })),
    );
  }

  async listDocuments(runId: string): Promise<Result<ExtractionDocument[]>> {
    return ok(
      [...this.documents.values()]
        .filter((document) => document.runId === runId)
        .map((document) => ({ ...document })),
    );
  }

  async getDocument(documentId: string): Promise<Result<ExtractionDocument | null>> {
    const document = this.documents.get(documentId);
    return ok(document ? { ...document } : null);
  }

  // Test helpers.
  documentById(id: string): ExtractionDocument | undefined {
    const document = this.documents.get(id);
    return document ? { ...document } : undefined;
  }

  recordById(id: string): StoredRecord | undefined {
    return this.records.get(id);
  }
}

// ── Supporting fakes ──────────────────────────────────────────────────────────

class FakeObjectStorage implements IObjectStorage {
  private objects = new Map<string, Buffer>();
  fail = false;

  async put(key: string, data: Buffer): Promise<Result<{ key: string }>> {
    this.objects.set(key, data);
    return ok({ key });
  }
  async get(key: string): Promise<Result<Buffer>> {
    if (this.fail) return err(domainError("INFRA_FAILURE", "storage down"));
    const data = this.objects.get(key);
    if (!data) return err(domainError("NOT_FOUND", "missing object"));
    return ok(data);
  }
  async delete(): Promise<Result<void>> {
    return ok(undefined);
  }
  async exists(key: string): Promise<Result<boolean>> {
    return ok(this.objects.has(key));
  }
  async initialise(): Promise<void> {}
  get storedKeys(): string[] {
    return [...this.objects.keys()];
  }
}

class FakeDocumentExtractor implements IDocumentExtractor {
  constructor(private readonly text: string = "extracted body text") {}
  async extract(): Promise<Result<string>> {
    return ok(this.text);
  }
}

interface FakeModelOptions {
  fieldValue?: string;
  fieldConfidence?: number;
  grouping?: { label: string; fileIds: string[] }[];
  fieldError?: ReturnType<typeof domainError>;
}

class FakeLanguageModel implements ILanguageModel {
  readonly provider = "anthropic" as const;
  constructor(private readonly options: FakeModelOptions = {}) {}

  async generateObject<T>(
    input: GenerateObjectInput,
  ): Promise<Result<{ object: T; usage: TokenUsage }>> {
    if (input.purpose === "extractionFileGrouping") {
      const records = this.options.grouping ?? [];
      return ok({ object: { records } as T, usage: ZERO_USAGE });
    }
    if (input.purpose === "extractionFieldExtraction") {
      if (this.options.fieldError) return err(this.options.fieldError);
      const object = {
        supplier_name: {
          value: this.options.fieldValue ?? "Acme Ltd",
          confidence: this.options.fieldConfidence ?? 90,
          rationale: "stated on the cover page",
        },
      };
      return ok({ object: object as T, usage: ZERO_USAGE });
    }
    return err(domainError("AI_PROVIDER_FAILED", `unexpected purpose ${input.purpose}`));
  }
  async generateText(): Promise<Result<{ text: string; usage: TokenUsage }>> {
    return err(domainError("AI_PROVIDER_FAILED", "not used"));
  }
  async streamText(): Promise<
    Result<{ textStream: AsyncIterable<string>; usage: Promise<TokenUsage> }>
  > {
    return err(domainError("AI_PROVIDER_FAILED", "not used"));
  }
  async streamObject<T>(): Promise<
    Result<{
      partialObjectStream: AsyncIterable<Partial<T>>;
      object: Promise<T>;
      usage: Promise<TokenUsage>;
    }>
  > {
    return err(domainError("AI_PROVIDER_FAILED", "not used"));
  }
}

class FakeArchiveExtractor implements IArchiveExtractor {
  constructor(private readonly entries: ArchiveEntry[] = []) {}
  async expand(_archive: Buffer, _limits: ArchiveLimits): Promise<Result<ArchiveEntry[]>> {
    return ok(this.entries.map((entry) => ({ ...entry })));
  }
}

class FakeFlowVersionRepository implements Partial<IFlowVersionRepository> {
  constructor(private readonly published: FlowVersion | null) {}
  async latestPublished(): Promise<Result<FlowVersion | null>> {
    return ok(this.published);
  }
  async getById(): Promise<Result<FlowVersion | null>> {
    return ok(this.published);
  }
}

const publishedVersion = (schema: ExtractionSchema): FlowVersion =>
  ({
    id: "version-1",
    flowId: "flow-1",
    versionNumber: 1,
    status: "published",
    snapshot: { kind: "extraction", nodes: [], edges: [], extraction: schema },
  }) as unknown as FlowVersion;

const flowVersionsWith = (schema: ExtractionSchema | null): IFlowVersionRepository =>
  new FakeFlowVersionRepository(
    schema ? publishedVersion(schema) : null,
  ) as unknown as IFlowVersionRepository;

const uploadedFile = (filename: string, treePath: string) => ({
  filename,
  treePath,
  mimeType: "text/plain",
  buffer: Buffer.from(`body of ${filename}`),
});

// ── StartBatchRun ─────────────────────────────────────────────────────────────

describe("StartBatchRun", () => {
  it("refuses to run a full batch without a published version", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const start = new StartBatchRun(
      flowVersionsWith(null),
      runs,
      new FakeObjectStorage(),
      new FakeArchiveExtractor(),
      new FakeLanguageModel(),
      new FakeDocumentExtractor(),
    );

    const result = await start.execute({
      flowId: "flow-1",
      userId: "user-1",
      files: [uploadedFile("a.txt", "a.txt")],
      archives: [],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Publish the extraction flow");
  });

  it("seeds one record per file under one-per-file and stores every document", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const start = new StartBatchRun(
      flowVersionsWith(buildSchema()),
      runs,
      storage,
      new FakeArchiveExtractor(),
      new FakeLanguageModel(),
      new FakeDocumentExtractor(),
    );

    const result = await start.execute({
      flowId: "flow-1",
      userId: "user-1",
      files: [uploadedFile("a.txt", "supplier-a/a.txt"), uploadedFile("b.txt", "supplier-b/b.txt")],
      archives: [],
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.mode).toBe("full");
    expect(result.data?.totalCount).toBe(2);
    expect(storage.storedKeys).toHaveLength(2);
    const counts = await runs.countByStatus(result.data!.id);
    expect(counts.data?.pending).toBe(2);
  });

  it("turns preview on by default above the file threshold", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const start = new StartBatchRun(
      flowVersionsWith(buildSchema()),
      runs,
      new FakeObjectStorage(),
      new FakeArchiveExtractor(),
      new FakeLanguageModel(),
      new FakeDocumentExtractor(),
    );
    const files = Array.from({ length: 6 }, (_, index) =>
      uploadedFile(`f${index}.txt`, `f${index}.txt`),
    );

    const result = await start.execute({ flowId: "flow-1", userId: "user-1", files, archives: [] });

    expect(result.data?.previewBoundary).toBeGreaterThan(0);
  });

  it("expands archives and groups many files into records, routing unmatched files to exceptions", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const archive = new FakeArchiveExtractor([
      { filename: "a1.txt", treePath: "supplier-a/a1.txt", mimeType: "text/plain", buffer: Buffer.from("a1") },
      { filename: "a2.txt", treePath: "supplier-a/a2.txt", mimeType: "text/plain", buffer: Buffer.from("a2") },
      { filename: "loose.txt", treePath: "loose.txt", mimeType: "text/plain", buffer: Buffer.from("loose") },
    ]);
    // The grouping model puts the first two documents in one record and leaves
    // the third unmatched.
    const model = new FakeLanguageModel({ grouping: [{ label: "Supplier A", fileIds: ["doc-2", "doc-3"] }] });
    const start = new StartBatchRun(
      flowVersionsWith(buildSchema({ cardinality: "many_per_record", selectionCriteria: "group by sub-folder" })),
      runs,
      new FakeObjectStorage(),
      archive,
      model,
      new FakeDocumentExtractor(),
    );

    const result = await start.execute({
      flowId: "flow-1",
      userId: "user-1",
      files: [],
      archives: [{ filename: "bundle.zip", buffer: Buffer.from("zip") }],
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.totalCount).toBe(3);
    // doc-4 is the loose file (ids: doc-2, doc-3, doc-4 after the run row took id run-1).
    const loose = runs.documentById("doc-4");
    expect(loose?.recordId).toBeNull();
    const grouped = runs.documentById("doc-2");
    expect(grouped?.recordId).not.toBeNull();
  });
});

// ── ProcessExtractionTask ─────────────────────────────────────────────────────

const seedClaimedDocument = async (
  runs: InMemoryExtractionRunRepository,
  options: { text?: string } = {},
): Promise<{ runId: string; document: ExtractionDocument; recordId: string }> => {
  const run = await runs.createRun({
    flowId: "flow-1",
    flowVersionId: "version-1",
    initiatedByUserId: "user-1",
    mode: "full",
    previewBoundary: 0,
  });
  await runs.addDocuments(run.data!.id, [
    { filename: "a.pdf", treePath: "a.pdf", storageKey: "key-a", mimeType: "application/pdf" },
  ]);
  const documents = await runs.claimPendingDocuments(run.data!.id, 10);
  const document = documents.data![0]!;
  const seeded = await runs.seedRecords(run.data!.id, [
    { ordinal: 1, label: "a.pdf", sourceDocumentIds: [document.id] },
  ]);
  return { runId: run.data!.id, document: { ...document, recordId: seeded.data![0]!.id }, recordId: seeded.data![0]!.id };
};

describe("ProcessExtractionTask", () => {
  it("extracts a document's fields and merges them into its record", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    await storage.put("key-a", Buffer.from("pdf bytes"));
    const { document, recordId } = await seedClaimedDocument(runs);

    const task = new ProcessExtractionTask(
      runs,
      storage,
      new FakeDocumentExtractor("full readable text"),
      new FakeLanguageModel({ fieldValue: "Globex", fieldConfidence: 88 }),
    );

    const result = await task.execute({ document, schema: buildSchema() });

    expect(result.error).toBeUndefined();
    expect(result.data?.doneCount).toBe(1);
    const record = runs.recordById(recordId);
    expect(record?.fields[0]).toMatchObject({ key: "supplier_name", value: "Globex" });
  });

  it("classifies an empty-text document as unreadable without calling the model", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    await storage.put("key-a", Buffer.from("scanned image bytes"));
    const { document } = await seedClaimedDocument(runs);

    const result = await new ProcessExtractionTask(
      runs,
      storage,
      new FakeDocumentExtractor("   "),
      new FakeLanguageModel(),
    ).execute({ document, schema: buildSchema() });

    expect(result.data?.unreadableCount).toBe(1);
    expect(runs.documentById(document.id)?.status).toBe("unreadable");
  });

  it("retries a transient failure while attempts remain", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    storage.fail = true;
    const { document } = await seedClaimedDocument(runs);

    const result = await new ProcessExtractionTask(
      runs,
      storage,
      new FakeDocumentExtractor(),
      new FakeLanguageModel(),
    ).execute({ document, schema: buildSchema() });

    expect(result.error).toBeUndefined();
    // attempts was 1 after the claim, under the cap of 3 → back to pending.
    expect(runs.documentById(document.id)?.status).toBe("pending");
    expect(result.data?.failedCount).toBe(0);
  });

  it("marks a document failed once the attempt cap is exhausted", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    storage.fail = true;
    const { document } = await seedClaimedDocument(runs);
    const exhausted = { ...document, attempts: 3 };

    const result = await new ProcessExtractionTask(
      runs,
      storage,
      new FakeDocumentExtractor(),
      new FakeLanguageModel(),
    ).execute({ document: exhausted, schema: buildSchema() });

    expect(runs.documentById(document.id)?.status).toBe("failed");
    expect(result.data?.failedCount).toBe(1);
  });

  it("returns a document to the queue and surfaces the error on a quota breach", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    await storage.put("key-a", Buffer.from("pdf bytes"));
    const { document } = await seedClaimedDocument(runs);

    const result = await new ProcessExtractionTask(
      runs,
      storage,
      new FakeDocumentExtractor("readable"),
      new FakeLanguageModel({ fieldError: domainError("QUOTA_EXCEEDED", "cap reached") }),
    ).execute({ document, schema: buildSchema() });

    expect(result.error?.code).toBe("QUOTA_EXCEEDED");
    expect(runs.documentById(document.id)?.status).toBe("pending");
  });
});

// ── Run controls ──────────────────────────────────────────────────────────────

describe("run controls", () => {
  const newRun = async (runs: InMemoryExtractionRunRepository) =>
    (
      await runs.createRun({
        flowId: "flow-1",
        flowVersionId: "version-1",
        initiatedByUserId: "user-1",
        mode: "full",
        previewBoundary: 0,
      })
    ).data!;

  it("cancels a running run", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const run = await newRun(runs);

    const result = await new CancelRun(runs).execute(run.id);

    expect(result.error).toBeUndefined();
    expect((await runs.getRun(run.id)).data?.status).toBe("cancelled");
  });

  it("refuses to cancel a finished run", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const run = await newRun(runs);
    await runs.updateRunStatus(run.id, "complete");

    const result = await new CancelRun(runs).execute(run.id);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("requeues failed documents and resumes the run", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const run = await newRun(runs);
    await runs.addDocuments(run.id, [
      { filename: "a.pdf", treePath: "a.pdf", storageKey: "k", mimeType: "application/pdf" },
    ]);
    const claimed = await runs.claimPendingDocuments(run.id, 10);
    await runs.settleDocument(claimed.data![0]!.id, { status: "failed", error: "boom" }, 0);
    await runs.updateRunStatus(run.id, "partial");

    const result = await new RetryFailed(runs).execute(run.id);

    expect(result.data?.retried).toBe(1);
    expect((await runs.getRun(run.id)).data?.status).toBe("running");
  });

  it("continues a run paused at the preview breakpoint", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const run = await newRun(runs);
    await runs.updateRunStatus(run.id, "paused_preview");

    const result = await new ContinueRun(runs).execute(run.id);

    expect(result.error).toBeUndefined();
    expect((await runs.getRun(run.id)).data?.status).toBe("running");
  });

  it("refuses to continue a run that is not paused", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const run = await newRun(runs);

    const result = await new ContinueRun(runs).execute(run.id);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

// ── AdvanceBatchRuns (worker tick) ────────────────────────────────────────────

const seedFullRun = async (
  runs: InMemoryExtractionRunRepository,
  storage: FakeObjectStorage,
  options: { documentCount: number; previewBoundary?: number },
): Promise<string> => {
  const run = await runs.createRun({
    flowId: "flow-1",
    flowVersionId: "version-1",
    initiatedByUserId: "user-1",
    mode: "full",
    previewBoundary: options.previewBoundary ?? 0,
  });
  const documents = Array.from({ length: options.documentCount }, (_, index) => ({
    filename: `d${index}.pdf`,
    treePath: `d${index}.pdf`,
    storageKey: `key-${index}`,
    mimeType: "application/pdf",
  }));
  for (const document of documents) await storage.put(document.storageKey, Buffer.from("bytes"));
  const created = await runs.addDocuments(run.data!.id, documents);
  await runs.seedRecords(
    run.data!.id,
    created.data!.map((document, index) => ({
      ordinal: index + 1,
      label: document.filename,
      sourceDocumentIds: [document.id],
    })),
  );
  return run.data!.id;
};

const advancerFor = (
  runs: InMemoryExtractionRunRepository,
  storage: FakeObjectStorage,
  options: { costPerCallUsd?: number; costCeilingUsd?: number } = {},
): AdvanceBatchRuns => {
  const processTask = new ProcessExtractionTask(
    runs,
    storage,
    new FakeDocumentExtractor("readable body"),
    new FakeLanguageModel({ fieldValue: "Acme", fieldConfidence: 80 }),
    options.costPerCallUsd ?? 0,
  );
  return new AdvanceBatchRuns(runs, flowVersionsWith(buildSchema()), processTask, {
    costCeilingUsd: options.costCeilingUsd,
  });
};

describe("AdvanceBatchRuns", () => {
  it("processes a run to completion and settles it complete", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const runId = await seedFullRun(runs, storage, { documentCount: 2 });

    const result = await advancerFor(runs, storage).execute();

    expect(result.data?.runsAdvanced).toBe(1);
    expect((await runs.getRun(runId)).data?.status).toBe("complete");
    expect((await runs.getRun(runId)).data?.doneCount).toBe(2);
  });

  it("pauses at the preview breakpoint without processing past it", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const runId = await seedFullRun(runs, storage, { documentCount: 3, previewBoundary: 1 });

    await advancerFor(runs, storage).execute();

    const run = (await runs.getRun(runId)).data!;
    expect(run.status).toBe("paused_preview");
    expect(run.doneCount).toBe(1);
    const counts = (await runs.countByStatus(runId)).data!;
    expect(counts.pending).toBe(2);
  });

  it("continuing a paused-preview run finishes the rest without re-processing", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const runId = await seedFullRun(runs, storage, { documentCount: 3, previewBoundary: 1 });
    await advancerFor(runs, storage).execute();

    await new ContinueRun(runs).execute(runId);
    await advancerFor(runs, storage).execute();

    const run = (await runs.getRun(runId)).data!;
    expect(run.status).toBe("complete");
    expect(run.doneCount).toBe(3);
  });

  it("pauses cleanly when the per-run cost ceiling is reached", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const runId = await seedFullRun(runs, storage, { documentCount: 3 });

    await advancerFor(runs, storage, { costPerCallUsd: 5, costCeilingUsd: 5 }).execute();

    const run = (await runs.getRun(runId)).data!;
    expect(run.status).toBe("paused_cap");
    expect(run.doneCount).toBe(1);
  });

  it("settles a run partial when a document has failed and the queue drains", async () => {
    const runs = new InMemoryExtractionRunRepository();
    const storage = new FakeObjectStorage();
    const runId = await seedFullRun(runs, storage, { documentCount: 1 });
    const claimed = await runs.claimPendingDocuments(runId, 10);
    await runs.settleDocument(claimed.data![0]!.id, { status: "failed", error: "boom" }, 0);

    await advancerFor(runs, storage).execute();

    expect((await runs.getRun(runId)).data?.status).toBe("partial");
  });
});
