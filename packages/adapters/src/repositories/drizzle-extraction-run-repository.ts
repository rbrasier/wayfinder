import {
  domainError,
  err,
  ok,
  type CreateRunInput,
  type DocumentOutcome,
  type ExtractionDocument,
  type ExtractionFieldResult,
  type ExtractionRecord,
  type ExtractionRun,
  type IExtractionRunRepository,
  type NewExtractionDocument,
  type NewExtractionRecord,
  type Result,
  type RunStatus,
  type RunStatusCounts,
} from "@rbrasier/domain";
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  app_extraction_documents,
  app_extraction_records,
  app_extraction_runs,
} from "../db/schema/wayfinder";

type RunRow = typeof app_extraction_runs.$inferSelect;
type DocumentRow = typeof app_extraction_documents.$inferSelect;
type RecordRow = typeof app_extraction_records.$inferSelect;

const toRun = (row: RunRow): ExtractionRun => ({
  id: row.id,
  flowId: row.flow_id,
  flowVersionId: row.flow_version_id,
  initiatedByUserId: row.initiated_by_user_id ?? "",
  mode: row.mode,
  status: row.status,
  previewBoundary: row.preview_boundary,
  totalCount: row.total_count,
  doneCount: row.done_count,
  failedCount: row.failed_count,
  unreadableCount: row.unreadable_count,
  costUsd: row.cost_usd,
});

const toDocument = (row: DocumentRow): ExtractionDocument => ({
  id: row.id,
  runId: row.run_id,
  recordId: row.record_id,
  filename: row.filename,
  treePath: row.tree_path,
  storageKey: row.storage_key,
  mimeType: row.mime_type,
  status: row.status,
  attempts: row.attempts,
  error: row.error,
});

const aggregateConfidenceOf = (fields: ExtractionFieldResult[]): number =>
  fields.length === 0 ? 0 : fields.reduce((lowest, field) => Math.min(lowest, field.confidence), 1);

// Atomic claim (ADR-019 / ADR-033 §6): one UPDATE marks a bounded batch of a
// run's pending documents `extracting` and bumps their attempt count, selecting
// them with FOR UPDATE SKIP LOCKED so two workers never claim the same row. The
// run id is bound as a parameter, never interpolated as text.
export const buildClaimPendingStatement = (runId: string, limit: number): SQL => sql`
  UPDATE ${app_extraction_documents}
  SET status = 'extracting', attempts = attempts + 1, updated_at = now()
  WHERE id IN (
    SELECT id FROM ${app_extraction_documents}
    WHERE run_id = ${runId} AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, run_id, record_id, filename, tree_path, storage_key, mime_type,
    status, attempts, error, created_at, updated_at
`;

// Drizzle-backed batch-engine persistence (ADR-033 §5-6). Never throws — every
// failure comes back as an INFRA_FAILURE Result.
export class DrizzleExtractionRunRepository implements IExtractionRunRepository {
  constructor(private readonly db: Database) {}

  private fail(message: string, cause: unknown): Result<never> {
    return err(domainError("INFRA_FAILURE", message, cause));
  }

  async createRun(input: CreateRunInput): Promise<Result<ExtractionRun>> {
    try {
      const [row] = await this.db
        .insert(app_extraction_runs)
        .values({
          flow_id: input.flowId,
          flow_version_id: input.flowVersionId,
          initiated_by_user_id: input.initiatedByUserId,
          mode: input.mode,
          preview_boundary: input.previewBoundary,
        })
        .returning();
      return ok(toRun(row!));
    } catch (cause) {
      return this.fail("Failed to create the extraction run.", cause);
    }
  }

  async getRun(runId: string): Promise<Result<ExtractionRun>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_extraction_runs)
        .where(eq(app_extraction_runs.id, runId))
        .limit(1);
      if (!row) return err(domainError("NOT_FOUND", "Extraction run not found."));
      return ok(toRun(row));
    } catch (cause) {
      return this.fail("Failed to load the extraction run.", cause);
    }
  }

  async updateRunStatus(runId: string, status: RunStatus): Promise<Result<void>> {
    try {
      await this.db
        .update(app_extraction_runs)
        .set({ status, updated_at: new Date() })
        .where(eq(app_extraction_runs.id, runId));
      return ok(undefined);
    } catch (cause) {
      return this.fail("Failed to update the run status.", cause);
    }
  }

  async continuePastPreview(runId: string): Promise<Result<void>> {
    try {
      await this.db
        .update(app_extraction_runs)
        .set({ status: "running", preview_boundary: 0, updated_at: new Date() })
        .where(eq(app_extraction_runs.id, runId));
      return ok(undefined);
    } catch (cause) {
      return this.fail("Failed to resume the run.", cause);
    }
  }

  async addDocuments(
    runId: string,
    documents: NewExtractionDocument[],
  ): Promise<Result<ExtractionDocument[]>> {
    if (documents.length === 0) return ok([]);
    try {
      const rows = await this.db
        .insert(app_extraction_documents)
        .values(
          documents.map((document) => ({
            run_id: runId,
            filename: document.filename,
            tree_path: document.treePath,
            storage_key: document.storageKey,
            mime_type: document.mimeType,
          })),
        )
        .returning();
      await this.db
        .update(app_extraction_runs)
        .set({ total_count: sql`${app_extraction_runs.total_count} + ${documents.length}`, updated_at: new Date() })
        .where(eq(app_extraction_runs.id, runId));
      return ok(rows.map(toDocument));
    } catch (cause) {
      return this.fail("Failed to add documents to the run.", cause);
    }
  }

  async seedRecords(
    runId: string,
    records: NewExtractionRecord[],
  ): Promise<Result<ExtractionRecord[]>> {
    if (records.length === 0) return ok([]);
    try {
      const inserted = await this.db
        .insert(app_extraction_records)
        .values(
          records.map((record) => ({
            run_id: runId,
            ordinal: record.ordinal,
            label: record.label,
          })),
        )
        .returning();

      for (const [index, record] of records.entries()) {
        if (record.sourceDocumentIds.length === 0) continue;
        await this.db
          .update(app_extraction_documents)
          .set({ record_id: inserted[index]!.id, updated_at: new Date() })
          .where(inArray(app_extraction_documents.id, record.sourceDocumentIds));
      }

      return ok(
        inserted.map((row, index) => this.toRecord(row, records[index]?.sourceDocumentIds ?? [])),
      );
    } catch (cause) {
      return this.fail("Failed to seed the run's records.", cause);
    }
  }

  async listClaimableRunIds(): Promise<Result<string[]>> {
    try {
      const rows = await this.db
        .select({ id: app_extraction_runs.id })
        .from(app_extraction_runs)
        .where(eq(app_extraction_runs.status, "running"));
      return ok(rows.map((row) => row.id));
    } catch (cause) {
      return this.fail("Failed to list claimable runs.", cause);
    }
  }

  async claimPendingDocuments(runId: string, limit: number): Promise<Result<ExtractionDocument[]>> {
    try {
      const rows = (await this.db.execute(
        buildClaimPendingStatement(runId, limit),
      )) as unknown as DocumentRow[];
      return ok(rows.map(toDocument));
    } catch (cause) {
      return this.fail("Failed to claim pending documents.", cause);
    }
  }

  async countByStatus(runId: string): Promise<Result<RunStatusCounts>> {
    try {
      const rows = await this.db
        .select({ status: app_extraction_documents.status, total: sql<number>`count(*)::int` })
        .from(app_extraction_documents)
        .where(eq(app_extraction_documents.run_id, runId))
        .groupBy(app_extraction_documents.status);

      const counts: RunStatusCounts = {
        pending: 0,
        extracting: 0,
        complete: 0,
        failed: 0,
        unreadable: 0,
      };
      for (const row of rows) counts[row.status] = Number(row.total);
      return ok(counts);
    } catch (cause) {
      return this.fail("Failed to count documents by status.", cause);
    }
  }

  async getRecord(recordId: string): Promise<Result<ExtractionRecord | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_extraction_records)
        .where(eq(app_extraction_records.id, recordId))
        .limit(1);
      if (!row) return ok(null);

      const sources = await this.db
        .select({ id: app_extraction_documents.id })
        .from(app_extraction_documents)
        .where(eq(app_extraction_documents.record_id, recordId));
      return ok(this.toRecord(row, sources.map((source) => source.id)));
    } catch (cause) {
      return this.fail("Failed to load the record.", cause);
    }
  }

  async saveRecordFields(
    recordId: string,
    fields: ExtractionFieldResult[],
  ): Promise<Result<void>> {
    try {
      await this.db
        .update(app_extraction_records)
        .set({
          fields,
          aggregate_confidence: aggregateConfidenceOf(fields),
          status: "complete",
          updated_at: new Date(),
        })
        .where(eq(app_extraction_records.id, recordId));
      return ok(undefined);
    } catch (cause) {
      return this.fail("Failed to save the record fields.", cause);
    }
  }

  async settleDocument(
    documentId: string,
    outcome: DocumentOutcome,
    costUsdDelta: number,
  ): Promise<Result<ExtractionRun>> {
    try {
      const [document] = await this.db
        .update(app_extraction_documents)
        .set({ status: outcome.status, error: outcome.error, updated_at: new Date() })
        .where(eq(app_extraction_documents.id, documentId))
        .returning();
      if (!document) return err(domainError("NOT_FOUND", "Document not found."));

      const [run] = await this.db
        .update(app_extraction_runs)
        .set({
          done_count: this.counterUpdate("done_count", outcome.status === "complete"),
          failed_count: this.counterUpdate("failed_count", outcome.status === "failed"),
          unreadable_count: this.counterUpdate("unreadable_count", outcome.status === "unreadable"),
          cost_usd: sql`${app_extraction_runs.cost_usd} + ${costUsdDelta}`,
          updated_at: new Date(),
        })
        .where(eq(app_extraction_runs.id, document.run_id))
        .returning();
      if (!run) return err(domainError("NOT_FOUND", "Run not found."));
      return ok(toRun(run));
    } catch (cause) {
      return this.fail("Failed to settle the document.", cause);
    }
  }

  async resetFailedToPending(runId: string): Promise<Result<number>> {
    try {
      const reset = await this.db
        .update(app_extraction_documents)
        .set({ status: "pending", attempts: 0, error: null, updated_at: new Date() })
        .where(
          and(
            eq(app_extraction_documents.run_id, runId),
            eq(app_extraction_documents.status, "failed"),
          ),
        )
        .returning({ id: app_extraction_documents.id });

      if (reset.length > 0) {
        await this.db
          .update(app_extraction_runs)
          .set({
            failed_count: sql`greatest(0, ${app_extraction_runs.failed_count} - ${reset.length})`,
            updated_at: new Date(),
          })
          .where(eq(app_extraction_runs.id, runId));
      }
      return ok(reset.length);
    } catch (cause) {
      return this.fail("Failed to requeue failed documents.", cause);
    }
  }

  async listRunsForFlow(flowId: string): Promise<Result<ExtractionRun[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_extraction_runs)
        .where(eq(app_extraction_runs.flow_id, flowId))
        .orderBy(desc(app_extraction_runs.created_at));
      return ok(rows.map(toRun));
    } catch (cause) {
      return this.fail("Failed to list the flow's runs.", cause);
    }
  }

  async listRecords(runId: string): Promise<Result<ExtractionRecord[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_extraction_records)
        .where(eq(app_extraction_records.run_id, runId))
        .orderBy(asc(app_extraction_records.ordinal));

      const documents = await this.db
        .select({ id: app_extraction_documents.id, recordId: app_extraction_documents.record_id })
        .from(app_extraction_documents)
        .where(eq(app_extraction_documents.run_id, runId));

      const sourcesByRecord = new Map<string, string[]>();
      for (const document of documents) {
        if (!document.recordId) continue;
        const list = sourcesByRecord.get(document.recordId) ?? [];
        list.push(document.id);
        sourcesByRecord.set(document.recordId, list);
      }

      return ok(rows.map((row) => this.toRecord(row, sourcesByRecord.get(row.id) ?? [])));
    } catch (cause) {
      return this.fail("Failed to list the run's records.", cause);
    }
  }

  async listDocuments(runId: string): Promise<Result<ExtractionDocument[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_extraction_documents)
        .where(eq(app_extraction_documents.run_id, runId))
        .orderBy(asc(app_extraction_documents.tree_path), asc(app_extraction_documents.filename));
      return ok(rows.map(toDocument));
    } catch (cause) {
      return this.fail("Failed to list the run's documents.", cause);
    }
  }

  async getDocument(documentId: string): Promise<Result<ExtractionDocument | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_extraction_documents)
        .where(eq(app_extraction_documents.id, documentId))
        .limit(1);
      return ok(row ? toDocument(row) : null);
    } catch (cause) {
      return this.fail("Failed to load the document.", cause);
    }
  }

  private counterUpdate(column: "done_count" | "failed_count" | "unreadable_count", hit: boolean): SQL {
    const current = app_extraction_runs[column];
    return hit ? sql`${current} + 1` : sql`${current}`;
  }

  private toRecord(row: RecordRow, sourceDocumentIds: string[]): ExtractionRecord {
    return {
      id: row.id,
      label: row.label,
      fields: row.fields,
      sourceDocumentIds,
    };
  }
}
