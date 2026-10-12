import PizZip from "pizzip";
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
  annotate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("annotated"), appliedCount: 0, unmatched: [] })),
});

const makeFailingDocGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFullText: vi.fn().mockReturnValue(err(domainError("INFRA_FAILURE", "parse failed"))),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("") })),
  annotate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("annotated"), appliedCount: 0, unmatched: [] })),
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

// A minimal workbook: two visible sheets (out of part order, to prove tab order
// wins) and one hidden sheet that must not be read.
const buildWorkbook = (): Buffer => {
  const zip = new PizZip();
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>' +
      '<sheet name="Compliance" sheetId="1" r:id="rId2"/>' +
      '<sheet name="Respondent &amp; Declarations" sheetId="2" r:id="rId1"/>' +
      '<sheet name="Lookups" sheetId="3" state="hidden" r:id="rId3"/>' +
      "</sheets></workbook>",
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0"?><Relationships>' +
      '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Target="worksheets/sheet3.xml"/>' +
      "</Relationships>",
  );
  zip.file(
    "xl/sharedStrings.xml",
    '<?xml version="1.0"?><sst><si><t>Requirement</t></si><si><t>Status</t></si>' +
      "<si><t>NFR-HOS-001</t></si><si><t>Compliant</t></si><si><t>NFR-HOS-002</t></si>" +
      "<si><t>Name</t></si><si><t>Acme | Pty Ltd</t></si><si><t>secret</t></si></sst>",
  );
  zip.file(
    "xl/worksheets/sheet2.xml",
    "<worksheet><sheetData>" +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>4</v></c></row>' +
      '<row r="4"><c r="A4" s="1"/><c r="B4" t="s"><v>3</v></c></row>' +
      "</sheetData></worksheet>",
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    "<worksheet><sheetData>" +
      '<row r="1"><c r="A1" t="s"><v>5</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>6</v></c></row>' +
      "</sheetData></worksheet>",
  );
  zip.file(
    "xl/worksheets/sheet3.xml",
    '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>7</v></c></row></sheetData></worksheet>',
  );
  return zip.generate({ type: "nodebuffer" });
};

describe("DocumentExtractorService.extract — XLSX", () => {
  it("renders each visible sheet as a table under its name, in tab order", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: buildWorkbook(), mimeType: XLSX_MIME });

    expect(result.error).toBeUndefined();
    const text = result.data ?? "";
    expect(text.indexOf("## Sheet: Compliance")).toBeLessThan(text.indexOf("## Sheet: Respondent & Declarations"));
    expect(text).toContain("| Requirement | Status |");
    expect(text).toContain("| NFR-HOS-001 | Compliant |");
  });

  it("shows a blank cell explicitly, because a blank compliance answer is a finding", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: buildWorkbook(), mimeType: XLSX_MIME });

    expect(result.data).toContain("| NFR-HOS-002 | BLANK |");
  });

  it("keeps a styled empty cell in its own column rather than shifting the next value into it", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: buildWorkbook(), mimeType: XLSX_MIME });

    expect(result.data).toContain("| BLANK | Compliant |");
  });

  it("escapes a pipe inside a cell so the table stays aligned", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: buildWorkbook(), mimeType: XLSX_MIME });

    expect(result.data).toContain("| Acme \\| Pty Ltd |");
  });

  it("does not read hidden sheets", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: buildWorkbook(), mimeType: XLSX_MIME });

    expect(result.data).not.toContain("Lookups");
    expect(result.data).not.toContain("secret");
  });

  it("returns an error for bytes that are not a workbook", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({ buffer: Buffer.from("fake xlsx"), mimeType: XLSX_MIME });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("DocumentExtractorService.extract — browser-reported type", () => {
  it("reads a Markdown file the browser reported as octet-stream, using its name", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({
      buffer: Buffer.from("# Vendor notes"),
      mimeType: "application/octet-stream",
      filename: "notes.md",
    });
    expect(result.data).toBe("# Vendor notes");
  });

  it("reads a CSV a Windows browser reported as application/vnd.ms-excel", async () => {
    const service = new DocumentExtractorService(makeDocGenerator(""));
    const result = await service.extract({
      buffer: Buffer.from("a,b\n1,2"),
      mimeType: "application/vnd.ms-excel",
      filename: "pricing.csv",
    });
    expect(result.data).toBe("a,b\n1,2");
  });
});

describe("DocumentExtractorService.extract — unsupported type", () => {
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
