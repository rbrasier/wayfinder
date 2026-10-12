// Supported document MIME types for extraction intake. Kept in step with
// DocumentExtractorService, which knows how to pull text from each.
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Office Open XML formats share the zip signature; only the name tells them
// apart from each other and from a nested archive.
const ZIP_CONTAINER_TYPES: Record<string, string> = {
  docx: DOCX_MIME,
  xlsx: XLSX_MIME,
};

const TEXT_EXTENSIONS: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04" — DOCX and XLSX are zip containers

const startsWith = (buffer: Buffer, magic: number[]): boolean =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);

const extensionOf = (filename: string): string => filename.toLowerCase().split(".").pop() ?? "";

// Sniffs a supported MIME type from content, trusting magic bytes over the
// extension (phase §2). PDFs and DOCX/XLSX (zip containers) are identified by
// their signature; a zip signature is only trusted as DOCX or XLSX when the name
// says so, so a nested/other zip is never mistaken for a document. Plain-text formats have no
// magic, so they fall back to the extension. Returns null for anything
// unrecognised — the caller routes those out rather than guessing.
export const sniffMimeType = (buffer: Buffer, filename: string): string | null => {
  if (startsWith(buffer, PDF_MAGIC)) return PDF_MIME;

  const extension = extensionOf(filename);
  if (startsWith(buffer, ZIP_MAGIC)) return ZIP_CONTAINER_TYPES[extension] ?? null;

  return TEXT_EXTENSIONS[extension] ?? null;
};
