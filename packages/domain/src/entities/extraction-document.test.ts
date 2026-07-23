import { describe, expect, it } from "vitest";
import {
  canRetryDocument,
  isExceptionDocument,
  MAX_DOCUMENT_ATTEMPTS,
  statusAfterFailure,
  type ExtractionDocument,
} from "./extraction-document";

const buildDocument = (overrides: Partial<ExtractionDocument> = {}): ExtractionDocument => ({
  id: "doc-1",
  runId: "run-1",
  recordId: "record-1",
  filename: "supplier-a.pdf",
  treePath: "supplier-a/response.pdf",
  storageKey: "runs/run-1/doc-1",
  mimeType: "application/pdf",
  status: "pending",
  attempts: 0,
  error: null,
  ...overrides,
});

describe("canRetryDocument", () => {
  it("allows a retry while attempts remain under the cap", () => {
    expect(canRetryDocument(buildDocument({ attempts: 0 }))).toBe(true);
    expect(canRetryDocument(buildDocument({ attempts: MAX_DOCUMENT_ATTEMPTS - 1 }))).toBe(true);
  });

  it("refuses a retry once the cap is reached", () => {
    expect(canRetryDocument(buildDocument({ attempts: MAX_DOCUMENT_ATTEMPTS }))).toBe(false);
  });
});

describe("statusAfterFailure", () => {
  it("returns to pending while retries remain so the worker re-claims it", () => {
    expect(statusAfterFailure(1)).toBe("pending");
  });

  it("lands on failed once the attempt cap is exhausted", () => {
    expect(statusAfterFailure(MAX_DOCUMENT_ATTEMPTS)).toBe("failed");
    expect(statusAfterFailure(MAX_DOCUMENT_ATTEMPTS + 1)).toBe("failed");
  });
});

describe("isExceptionDocument", () => {
  it("flags failed and unreadable documents as exceptions", () => {
    expect(isExceptionDocument(buildDocument({ status: "failed" }))).toBe(true);
    expect(isExceptionDocument(buildDocument({ status: "unreadable" }))).toBe(true);
  });

  it("flags a document matched by no record as an exception", () => {
    expect(isExceptionDocument(buildDocument({ status: "complete", recordId: null }))).toBe(true);
  });

  it("does not flag a healthy, grouped document", () => {
    expect(isExceptionDocument(buildDocument({ status: "complete", recordId: "record-1" }))).toBe(
      false,
    );
  });
});
