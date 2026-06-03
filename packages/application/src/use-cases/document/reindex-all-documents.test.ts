import { describe, it, expect } from "vitest";
import {
  domainError,
  err,
  ok,
  type IDocumentIndexer,
  type IJobRepository,
  type IReindexSourceRepository,
  type IndexDocumentInput,
  type Job,
  type ReindexableDocument,
  type Result,
} from "@rbrasier/domain";
import { REINDEX_JOB_NAME, ReindexAllDocuments } from "./reindex-all-documents";

const aJob = (name: string): Job => ({
  id: "job-1",
  name,
  status: "healthy",
  lastRunAt: null,
  nextRunAt: null,
  errorCount: 0,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

class FakeReindexSource implements IReindexSourceRepository {
  constructor(
    private readonly behaviour: { documents: ReindexableDocument[] } | { error: true },
  ) {}
  async listReindexableDocuments(): Promise<Result<ReindexableDocument[]>> {
    if ("error" in this.behaviour) {
      return err(domainError("INFRA_FAILURE", "could not read documents"));
    }
    return ok(this.behaviour.documents);
  }
}

class FakeIndexer implements IDocumentIndexer {
  public calls: IndexDocumentInput[] = [];
  constructor(private readonly failingStoragePaths: Set<string> = new Set()) {}
  async indexDocument(input: IndexDocumentInput): Promise<Result<{ chunkCount: number }>> {
    this.calls.push(input);
    if (this.failingStoragePaths.has(input.storagePath)) {
      return err(domainError("AI_PROVIDER_FAILED", "embed failed"));
    }
    return ok({ chunkCount: 2 });
  }
}

class FakeJobs implements IJobRepository {
  public registered: string[] = [];
  public pinged: string[] = [];
  public failed: { name: string; error: string }[] = [];
  async register(name: string): Promise<Result<Job>> {
    this.registered.push(name);
    return ok(aJob(name));
  }
  async ping(name: string): Promise<Result<Job>> {
    this.pinged.push(name);
    return ok(aJob(name));
  }
  async fail(name: string, error: string): Promise<Result<Job>> {
    this.failed.push({ name, error });
    return ok(aJob(name));
  }
  async list(): Promise<Result<Job[]>> {
    return ok([]);
  }
}

const contextDoc: ReindexableDocument = {
  flowId: "flow-1",
  sessionId: null,
  sourceType: "flow_context_doc",
  storagePath: "context/flow-1/policy.pdf",
  filename: "policy.pdf",
  text: "A policy document.",
};

const template: ReindexableDocument = {
  flowId: "flow-1",
  sessionId: null,
  sourceType: "template",
  storagePath: "templates/node-1/letter.docx",
  filename: "letter.docx",
  text: "Dear {{ client_name }}.",
};

const sessionUpload: ReindexableDocument = {
  flowId: null,
  sessionId: "session-1",
  sourceType: "session_upload",
  storagePath: "session/session-1/notes.txt",
  filename: "notes.txt",
  text: "Some uploaded notes.",
};

describe("ReindexAllDocuments", () => {
  it("re-indexes every document and pings the job when all succeed", async () => {
    const source = new FakeReindexSource({ documents: [contextDoc, template, sessionUpload] });
    const indexer = new FakeIndexer();
    const jobs = new FakeJobs();
    const useCase = new ReindexAllDocuments(source, indexer, jobs);

    const result = await useCase.execute();

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual({ total: 3, succeeded: 3, failed: 0 });
    expect(indexer.calls.map((call) => call.storagePath)).toEqual([
      contextDoc.storagePath,
      template.storagePath,
      sessionUpload.storagePath,
    ]);
    expect(jobs.registered).toEqual([REINDEX_JOB_NAME]);
    expect(jobs.pinged).toEqual([REINDEX_JOB_NAME]);
    expect(jobs.failed).toEqual([]);
  });

  it("passes each document's stored text and scope straight through to the indexer", async () => {
    const source = new FakeReindexSource({ documents: [template] });
    const indexer = new FakeIndexer();
    const jobs = new FakeJobs();

    await new ReindexAllDocuments(source, indexer, jobs).execute();

    expect(indexer.calls[0]).toEqual({
      flowId: "flow-1",
      sessionId: null,
      sourceType: "template",
      storagePath: "templates/node-1/letter.docx",
      filename: "letter.docx",
      text: "Dear {{ client_name }}.",
    });
  });

  it("continues past a document that fails to index and reports the counts", async () => {
    const source = new FakeReindexSource({ documents: [contextDoc, template, sessionUpload] });
    const indexer = new FakeIndexer(new Set([template.storagePath]));
    const jobs = new FakeJobs();

    const result = await new ReindexAllDocuments(source, indexer, jobs).execute();

    expect(result.data).toEqual({ total: 3, succeeded: 2, failed: 1 });
    expect(indexer.calls).toHaveLength(3);
    expect(jobs.pinged).toEqual([REINDEX_JOB_NAME]);
    expect(jobs.failed).toEqual([]);
  });

  it("reports progress after each document", async () => {
    const source = new FakeReindexSource({ documents: [contextDoc, sessionUpload] });
    const indexer = new FakeIndexer();
    const jobs = new FakeJobs();
    const progress: { processed: number; succeeded: number; failed: number; total: number }[] = [];

    await new ReindexAllDocuments(source, indexer, jobs).execute({
      onProgress: (snapshot) => progress.push({ ...snapshot }),
    });

    expect(progress[0]).toEqual({ total: 2, processed: 0, succeeded: 0, failed: 0 });
    expect(progress[progress.length - 1]).toEqual({
      total: 2,
      processed: 2,
      succeeded: 2,
      failed: 0,
    });
  });

  it("fails the job and returns the error when documents cannot be listed", async () => {
    const source = new FakeReindexSource({ error: true });
    const indexer = new FakeIndexer();
    const jobs = new FakeJobs();

    const result = await new ReindexAllDocuments(source, indexer, jobs).execute();

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(indexer.calls).toHaveLength(0);
    expect(jobs.failed).toEqual([{ name: REINDEX_JOB_NAME, error: "could not read documents" }]);
    expect(jobs.pinged).toEqual([]);
  });

  it("reports zero counts and still pings the job when there are no documents", async () => {
    const source = new FakeReindexSource({ documents: [] });
    const indexer = new FakeIndexer();
    const jobs = new FakeJobs();

    const result = await new ReindexAllDocuments(source, indexer, jobs).execute();

    expect(result.data).toEqual({ total: 0, succeeded: 0, failed: 0 });
    expect(jobs.pinged).toEqual([REINDEX_JOB_NAME]);
  });
});
