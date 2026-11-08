import type { Result } from "../result";

// Renders a .docx to PDF/A-2b (ADR-067 §3). Behind a port because the only
// practical renderer is LibreOffice, which runs as the Gotenberg sidecar rather
// than in the application image.
export interface IPdfConverter {
  convertDocxToPdfA(docxBytes: Buffer): Promise<Result<Buffer>>;
}
