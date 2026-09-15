import type { ExtractionDocument } from "../entities/extraction-document";
import type { ExtractionFieldResult, ExtractionRecord } from "../entities/extraction-record";
import type { ExtractionRun, RunMode, RunStatus } from "../entities/extraction-run";
import type { Result } from "../result";

export interface CreateRunInput {
  flowId: string;
  // Null only for an analyse run, which drafts the schema the first version will
  // be built from (ADR-060 §2). Sample and full runs always supply one.
  flowVersionId: string | null;
  initiatedByUserId: string;
  mode: RunMode;
  // 0 disables the preview pause (phase §6).
  previewBoundary: number;
  // Set at creation for an analyse run, whose work is known up front. Sample and
  // full runs leave it out and derive the total from the documents added.
  totalCount?: number;
}

// How an analysis finished: how many documents it read and how many it could not
// (ADR-060 §5). `partial` means some document was unreadable, whether or not a
// field set was still produced from the rest.
export interface AnalysisOutcome {
  status: "complete" | "partial";
  documentsRead: number;
  documentsUnreadable: number;
}

// A file to ingest as the unit of work. The run's total is derived from the
// documents added, so callers add documents before extraction begins.
export interface NewExtractionDocument {
  filename: string;
  treePath: string;
  storageKey: string;
  mimeType: string;
}

// A record materialised by the grouping pass (ADR-033 §4a). `sourceDocumentIds`
// are the ids returned from addDocuments; the repository links each document row
// to this record.
export interface NewExtractionRecord {
  ordinal: number;
  label: string;
  sourceDocumentIds: string[];
}

// COUNT(*) GROUP BY status for a run — the cheap progress query (phase §8) and
// the drain check (no pending/extracting left).
export interface RunStatusCounts {
  pending: number;
  extracting: number;
  complete: number;
  failed: number;
  unreadable: number;
}

// The terminal outcome of one document's extraction. `pending` means "retry" —
// the attempt failed but the cap is not yet reached, so no run counter moves.
export interface DocumentOutcome {
  status: "complete" | "failed" | "unreadable" | "pending";
  error: string | null;
}

// Persistence for the batch engine (ADR-033 §5-6). Claiming uses
// FOR UPDATE SKIP LOCKED so multiple workers never double-claim a document.
// Every method returns a Result — nothing throws across the boundary.
export interface IExtractionRunRepository {
  createRun(input: CreateRunInput): Promise<Result<ExtractionRun>>;
  getRun(runId: string): Promise<Result<ExtractionRun>>;
  updateRunStatus(runId: string, status: RunStatus): Promise<Result<void>>;
  // Resumes a run paused at the preview breakpoint: status back to `running` and
  // the boundary cleared so the run never pauses at it again (phase §6).
  continuePastPreview(runId: string): Promise<Result<void>>;

  // Ingestion + grouping.
  addDocuments(
    runId: string,
    documents: NewExtractionDocument[],
  ): Promise<Result<ExtractionDocument[]>>;
  seedRecords(runId: string, records: NewExtractionRecord[]): Promise<Result<ExtractionRecord[]>>;

  // Worker loop.
  listClaimableRunIds(): Promise<Result<string[]>>;
  claimPendingDocuments(runId: string, limit: number): Promise<Result<ExtractionDocument[]>>;

  // Analyse runs claim the run itself rather than document rows, because the
  // proposal call is one indivisible step over all the documents (ADR-060 §4).
  // Returns null when another worker holds the claim, so an overlapping tick
  // never double-spends. A claim older than `staleAfterMs` is reclaimable, which
  // is how a run survives the worker dying mid-analysis.
  claimAnalysisRun(runId: string, staleAfterMs: number): Promise<Result<ExtractionRun | null>>;
  settleAnalysisRun(
    runId: string,
    outcome: AnalysisOutcome,
    costUsdDelta: number,
  ): Promise<Result<ExtractionRun>>;
  // Releases a claim without settling, so a failure that is worth retrying does
  // not leave the run stuck until its claim goes stale.
  releaseAnalysisClaim(runId: string): Promise<Result<void>>;
  countByStatus(runId: string): Promise<Result<RunStatusCounts>>;

  // Results: attach a document's extracted fields to its record, then settle the
  // document (bumping the matching run counter and accruing cost) and return the
  // updated run so the caller can check the preview boundary / drain.
  getRecord(recordId: string): Promise<Result<ExtractionRecord | null>>;
  saveRecordFields(recordId: string, fields: ExtractionFieldResult[]): Promise<Result<void>>;
  settleDocument(
    documentId: string,
    outcome: DocumentOutcome,
    costUsdDelta: number,
  ): Promise<Result<ExtractionRun>>;

  // Controls.
  resetFailedToPending(runId: string): Promise<Result<number>>;

  // Reads for the run-history list, the results viewer, document generation, and
  // exports (phase §2-5). Records/documents come back fully materialised (each
  // record with its sourceDocumentIds) so the viewer, exporter, and doc generator
  // read the same server-side truth.
  listRunsForFlow(flowId: string): Promise<Result<ExtractionRun[]>>;
  listRecords(runId: string): Promise<Result<ExtractionRecord[]>>;
  listDocuments(runId: string): Promise<Result<ExtractionDocument[]>>;
  getDocument(documentId: string): Promise<Result<ExtractionDocument | null>>;
}
