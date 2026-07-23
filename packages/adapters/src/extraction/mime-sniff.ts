// Supported document MIME types for extraction intake. Kept in step with
// DocumentExtractorService, which knows how to pull text from each.
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";

const TEXT_EXTENSIONS: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — DOCX is a zip container

const startsWith = (buffer: Buffer, magic: number[]): boolean =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);

const extensionOf = (filename: string): string => filename.toLowerCase().split(".").pop() ?? "";

// Sniffs a supported MIME type from content, trusting magic bytes over the
// extension (phase §2). PDFs and DOCX (a zip container) are identified by their
// signature; a zip signature is only trusted as DOCX when the name says so, so a
// nested/other zip is never mistaken for a document. Plain-text formats have no
// magic, so they fall back to the extension. Returns null for anything
// unrecognised — the caller routes those out rather than guessing.
export const sniffMimeType = (buffer: Buffer, filename: string): string | null => {
  if (startsWith(buffer, PDF_MAGIC)) return PDF_MIME;

  const extension = extensionOf(filename);
  if (startsWith(buffer, ZIP_MAGIC)) return extension === "docx" ? DOCX_MIME : null;

  return TEXT_EXTENSIONS[extension] ?? null;
};
