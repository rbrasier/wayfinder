import { describe, it, expect, vi } from "vitest";
import { DocumentExtractorService } from "./document-extractor-service";
import type { IDocumentGenerator } from "@rbrasier/domain";
import { ok, err, domainError } from "@rbrasier/domain";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const TEXT_MIME = "text/plain";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const makeDocGenerator = (extractedText: string): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFullText: vi.fn().mockReturnValue(ok({ text: extractedText })),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("") })),
});

const makeFailingDocGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFullText: vi.fn().mockReturnValue(err(domainError("INFRA_FAILURE", "parse failed"))),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("") })),
});

// ── DOCX extraction ──────────────────────────────────────────────────────────

describe("DocumentExtractorService.extract — DOCX", () => {
  it("returns extracted text for a valid DOCX buffer", async () => {
    const service = new DocumentExtractorService(makeDocGenerator("Hello from docx."));
    const result = await service.extract({ buffer: Buffer.from("fake docx"), mimeType: DOCX_MIME });
    expect(result.error).toBeUndefined();
    expect(result.data).toBe("Hello from docx.");
  });

  it("returns error when DOCX extraction fails", async () => {
    const service = new DocumentExtractorService(makeFailingDocGenerator());
    const result = await service.extract({ buffer: Buffer.from("bad docx"), mimeType: DOCX_MIME });
    expect(result.error).toBeDefined();
    expect(result.data).toBeUndefined();
  });

  it("returns DOCX text unchanged regardless of length (caller enforces size limits)", async () => {
    const longText = "a ".repeat(20_000); // 40 000 chars
    const service = new DocumentExtractorService(makeDocGenerator(longText));
    const result = await service.extract({ buffer: Buffer.from("fake"), mimeType: DOCX_MIME });
    expect(result.error).toBeUndefined();
    expect((result.data ?? "").length).toBe(longText.length);
  });
});

// ── Plain text extraction ────────────────────────────────────────────────────

describe("DocumentExtractorService.extract — plain text", () => {
  it("returns UTF-8 content for text/plain", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const content = "This is plain text content.";
    const result = await service.extract({ buffer: Buffer.from(content, "utf-8"), mimeType: TEXT_MIME });
    expect(result.error).toBeUndefined();
    expect(result.data).toBe(content);
  });

  it("returns plain text unchanged regardless of length (caller enforces size limits)", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const longText = "x".repeat(40_000);
    const result = await service.extract({ buffer: Buffer.from(longText, "utf-8"), mimeType: TEXT_MIME });
    expect(result.error).toBeUndefined();
    expect((result.data ?? "").length).toBe(40_000);
  });

  it("returns UTF-8 content for text/markdown", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const md = "# Heading\n\nParagraph content.";
    const result = await service.extract({ buffer: Buffer.from(md, "utf-8"), mimeType: "text/markdown" });
    expect(result.error).toBeUndefined();
    expect(result.data).toContain("Heading");
  });
});

// ── Unsupported MIME type ────────────────────────────────────────────────────

describe("DocumentExtractorService.extract — unsupported type", () => {
  it("returns error for xlsx", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: Buffer.from("fake xlsx"), mimeType: XLSX_MIME });
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns error for unknown mime type", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: Buffer.from("data"), mimeType: "image/png" });
    expect(result.error).toBeDefined();
  });
});

// ── PDF extraction (integration-style, skipped in unit context) ─────────────
// PDF extraction uses pdfjs-dist which requires a real PDF buffer.
// Covered by the acceptance criteria test run against actual uploaded files.
// Unit tests for PDF rely on checking error handling for invalid buffers.

describe("DocumentExtractorService.extract — PDF error path", () => {
  it("returns error when PDF buffer is invalid", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: Buffer.from("not a pdf"), mimeType: PDF_MIME });
    expect(result.error).toBeDefined();
  });
});
