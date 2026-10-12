import PizZip from "pizzip";
import { domainError, err, ok } from "@rbrasier/domain";
import type { IDocumentExtractor, IDocumentGenerator, Result } from "@rbrasier/domain";
import { PDFParse } from "pdf-parse";
import { listSheets, readSharedStrings, readSheet } from "../spreadsheets/xlsx-workbook";
import { DOCX_MIME, PDF_MIME, sniffMimeType, XLSX_MIME } from "./mime-sniff";

const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);

const isSupported = (mimeType: string): boolean =>
  mimeType === DOCX_MIME || mimeType === PDF_MIME || mimeType === XLSX_MIME || TEXT_MIMES.has(mimeType);

// A blank cell is written out rather than left empty: in a compliance workbook
// an unanswered cell is itself the finding, and an empty table cell reads to the
// model as "nothing here".
const BLANK_CELL = "BLANK";

const toTableCell = (value: string): string => {
  const trimmed = value.replace(/\r?\n/g, " ").trim();
  return trimmed.length === 0 ? BLANK_CELL : trimmed.replaceAll("|", "\\|");
};

const toTableRow = (cells: string[], width: number): string => {
  const padded = Array.from({ length: width }, (_, index) => toTableCell(cells[index] ?? ""));
  return `| ${padded.join(" | ")} |`;
};

// Renders one sheet as a Markdown table whose first row is the header. Rows with
// no value at all are dropped; they carry nothing and inflate the prompt.
const renderSheet = (name: string, grid: string[][]): string => {
  const rows = grid.filter((cells) => cells.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) return `## Sheet: ${name}\n\n(empty sheet)`;
  const width = Math.max(...rows.map((cells) => cells.length));
  const [header = [], ...body] = rows;
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  const lines = [toTableRow(header, width), separator, ...body.map((cells) => toTableRow(cells, width))];
  return `## Sheet: ${name}\n\n${lines.join("\n")}`;
};

// pdf-parse returns the text layer only; a scanned document yields empty or
// whitespace-only text. Treat that as unreadable and route it to exceptions
// rather than extracting confident nonsense from a blank page (phase §4). OCR is
// out of scope (ADR-030).
export const isReadableText = (text: string): boolean => text.trim().length > 0;

export class DocumentExtractorService implements IDocumentExtractor {
  constructor(private readonly documentGenerator: IDocumentGenerator) {}

  async extract(params: {
    buffer: Buffer;
    mimeType: string;
    filename?: string;
  }): Promise<Result<string>> {
    const { buffer } = params;
    const mimeType = this.resolveMimeType(params);

    if (mimeType === DOCX_MIME) return this.extractDocx(buffer);
    if (mimeType === PDF_MIME) return this.extractPdf(buffer);
    if (mimeType === XLSX_MIME) return this.extractXlsx(buffer);
    if (TEXT_MIMES.has(mimeType)) return ok(buffer.toString("utf-8"));

    return err(domainError("VALIDATION_FAILED", `Unsupported MIME type for text extraction: ${mimeType}`));
  }

  // A supported stored type is trusted as before. An unsupported one is usually
  // a browser's guess (an empty type for .md, application/vnd.ms-excel for .csv),
  // so the type is re-derived from the bytes and the file name when one is given.
  private resolveMimeType(params: { buffer: Buffer; mimeType: string; filename?: string }): string {
    if (isSupported(params.mimeType) || !params.filename) return params.mimeType;
    return sniffMimeType(params.buffer, params.filename) ?? params.mimeType;
  }

  // Every visible sheet, in tab order, as a Markdown table under its sheet name.
  // Hidden sheets are left out: they usually hold lookups and formula scaffolding
  // the respondent never saw. Formula cells contribute their cached value.
  private extractXlsx(buffer: Buffer): Result<string> {
    try {
      const zip = new PizZip(buffer);
      const sharedStrings = readSharedStrings(zip);
      const sections = listSheets(zip)
        .filter((sheet) => !sheet.hidden)
        .map((sheet) => renderSheet(sheet.name, readSheet(zip.file(sheet.part)?.asText() ?? "", sharedStrings)));
      return ok(sections.join("\n\n"));
    } catch (cause) {
      return err(domainError("VALIDATION_FAILED", "Could not read the spreadsheet.", cause));
    }
  }

  private extractDocx(buffer: Buffer): Result<string> {
    const result = this.documentGenerator.extractFullText({ templateBytes: buffer });
    if (result.error) return result;
    return ok(result.data.text);
  }

  private async extractPdf(buffer: Buffer): Promise<Result<string>> {
    let parser: PDFParse | null = null;
    try {
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return ok(result.text ?? "");
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to extract text from PDF.", cause));
    } finally {
      if (parser) await parser.destroy().catch(() => undefined);
    }
  }
}
