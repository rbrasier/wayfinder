// An input document staged against an extraction flow's draft, before any run
// is started (progressive upload — ADR-033). Persisted so the author's intake
// survives leaving the editor and seeds the run when a sample is started.
export interface ExtractionDraftDocument {
  id: string;
  flowId: string;
  filename: string;
  // Folder path preserved from the upload (a zip or a directory drop), so the
  // tree renders sub-folders and the grouping pass can use folder criteria.
  treePath: string;
  storageKey: string;
  mimeType: string;
}

export interface NewExtractionDraftDocument {
  filename: string;
  treePath: string;
  storageKey: string;
  mimeType: string;
}

// A file the intake declined to stage, kept so the author is told what was left
// out and why rather than finding the evidence missing later.
export interface SkippedUpload {
  filename: string;
  treePath: string;
  reason: string;
}

// The file types extraction can read. The upload picker's filter and the
// supported-types copy are derived from this list so they never drift from it.
export const SUPPORTED_UPLOAD_EXTENSIONS = ["pdf", "docx", "xlsx", "txt", "md", "csv"] as const;

const extensionOf = (filename: string): string | null => {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
};

// Operating-system metadata that rides along in archives and folder drops
// (macOS resource forks, Finder and Explorer files). Never the author's evidence,
// so it is dropped without being reported as a skip.
export const isSystemFile = (treePath: string): boolean => {
  const segments = treePath.replace(/\\/g, "/").split("/");
  const filename = segments[segments.length - 1] ?? "";
  if (segments.includes("__MACOSX")) return true;
  if (filename.startsWith("._")) return true;
  return [".DS_Store", "Thumbs.db", "desktop.ini"].includes(filename);
};

export const unsupportedFileReason = (filename: string): string => {
  const extension = extensionOf(filename);
  if (!extension) return "Skipped: this file type is not supported.";
  if ((SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    return `Skipped: the file's content is not a readable .${extension} document.`;
  }
  return `Skipped: .${extension} files are not supported.`;
};
