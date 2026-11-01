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
  // Characters of readable text, measured once at upload so the run setup can
  // estimate size before anything is sent to a model (issue #335). 0 means no
  // readable text; null means unknown — staged before this was recorded, or the
  // extractor failed.
  textLength: number | null;
}

export interface NewExtractionDraftDocument {
  filename: string;
  treePath: string;
  storageKey: string;
  mimeType: string;
  textLength: number | null;
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

export const isSupportedUpload = (filename: string): boolean => {
  const extension = extensionOf(filename);
  return extension !== null && (SUPPORTED_UPLOAD_EXTENSIONS as readonly string[]).includes(extension);
};

const folderOf = (treePath: string): string => {
  const slash = treePath.lastIndexOf("/");
  return slash === -1 ? "" : treePath.slice(0, slash);
};

const groupInOrder = <T>(items: T[], keyOf: (item: T) => string): T[][] => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.values()];
};

// Takes one item from each group in turn, preserving order within each group.
const interleave = <T>(groups: T[][]): T[] => {
  const longest = Math.max(0, ...groups.map((group) => group.length));
  const interleaved: T[] = [];
  for (let index = 0; index < longest; index += 1) {
    interleaved.push(...groups.filter((group) => index < group.length).map((group) => group[index]!));
  }
  return interleaved;
};

// Orders staged documents for Auto Analyse so a small sample is representative.
// Uploads arrive folder by folder, so the first few files are usually one
// vendor's; taking them in upload order would show the proposer one vendor and
// often one file type. Instead the sample rotates across sub-folders, and within
// a folder across file types, and leaves out types extraction cannot read.
export const chooseAnalysisSample = <T extends { filename: string; treePath: string }>(
  documents: T[],
  limit: number = documents.length,
): T[] => {
  const readable = documents.filter((document) => isSupportedUpload(document.filename));
  const folders = groupInOrder(readable, (document) => folderOf(document.treePath)).map((files) =>
    interleave(groupInOrder(files, (document) => extensionOf(document.filename) ?? "")),
  );
  return interleave(folders).slice(0, limit);
};
