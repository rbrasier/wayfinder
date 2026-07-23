import { domainError, err, ok } from "@rbrasier/domain";
import type { IDocumentExtractor, IDocumentGenerator, Result } from "@rbrasier/domain";
import { PDFParse } from "pdf-parse";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);
const PDF_MIME = "application/pdf";

// pdf-parse returns the text layer only; a scanned document yields empty or
// whitespace-only text. Treat that as unreadable and route it to exceptions
// rather than extracting confident nonsense from a blank page (phase §4). OCR is
// out of scope (ADR-030).
export const isReadableText = (text: string): boolean => text.trim().length > 0;

export class DocumentExtractorService implements IDocumentExtractor {
  constructor(private readonly documentGenerator: IDocumentGenerator) {}

  async extract(params: { buffer: Buffer; mimeType: string }): Promise<Result<string>> {
    const { buffer, mimeType } = params;

    if (mimeType === DOCX_MIME) return this.extractDocx(buffer);
    if (mimeType === PDF_MIME) return this.extractPdf(buffer);
    if (TEXT_MIMES.has(mimeType)) return ok(buffer.toString("utf-8"));

    return err(domainError("VALIDATION_FAILED", `Unsupported MIME type for text extraction: ${mimeType}`));
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
