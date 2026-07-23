// The per-input-file row — the unit of work the worker claims, extracts, and
// retries (ADR-033 §5). `pending` is claimable; `extracting` is in-flight;
// `complete`/`failed`/`unreadable` are settled.
export type ExtractionDocumentStatus = "pending" | "extracting" | "complete" | "failed" | "unreadable";

// A document is retried up to this many times before it lands as `failed`
// (phase §5). Kept here so the worker and the process-task use-case agree.
export const MAX_DOCUMENT_ATTEMPTS = 3;

export interface ExtractionDocument {
  id: string;
  runId: string;
  // Set by the grouping pass (ADR-033 §4a). Null means the file matched no
  // record and belongs in the exceptions bucket.
  recordId: string | null;
  filename: string;
  // Preserved folder structure so the viewer and the grouping pass can use it.
  treePath: string;
  storageKey: string;
  mimeType: string;
  status: ExtractionDocumentStatus;
  attempts: number;
  error: string | null;
}

export const canRetryDocument = (
  document: ExtractionDocument,
  cap: number = MAX_DOCUMENT_ATTEMPTS,
): boolean => document.attempts < cap;

// After a failed attempt the document goes back to `pending` (the worker will
// re-claim it) until the cap is exhausted, at which point it is `failed` for
// good.
export const statusAfterFailure = (
  attempts: number,
  cap: number = MAX_DOCUMENT_ATTEMPTS,
): "pending" | "failed" => (attempts >= cap ? "failed" : "pending");

// The exceptions bucket surfaces every file the operator should look at: those
// that failed extraction, those with no readable text, and those the grouping
// pass matched to no record (ADR-033 §4a). Never silently dropped.
export const isExceptionDocument = (document: ExtractionDocument): boolean =>
  document.status === "failed" ||
  document.status === "unreadable" ||
  document.recordId === null;
