import type { Result } from "../result";

// One sanitised entry pulled from an uploaded archive. `treePath` preserves the
// archive's folder structure (ADR-033 §5); `buffer` is the decompressed bytes,
// already bounded by the extractor's per-entry cap.
export interface ArchiveEntry {
  filename: string;
  treePath: string;
  mimeType: string;
  buffer: Buffer;
}

// Runtime-configurable intake limits, mirroring getSessionUploadConfig
// (phase §2). All are hard safety limits, not polish — the expansion path is
// untrusted input (phase §5).
export interface ArchiveLimits {
  maxEntries: number;
  maxEntryBytes: number;
  // Rejects a decompression bomb: total uncompressed bytes across all entries.
  maxTotalBytes: number;
}

// Expands an uploaded zip into sanitised, tree-preserving entries. Enforces
// entry-count, per-entry-size, decompression-bomb, and zip-slip guards, and
// sniffs MIME from content rather than trusting the extension (ADR-033, phase
// §2/§5). Never throws — a malformed or unsafe archive returns a DomainError.
export interface IArchiveExtractor {
  expand(archive: Buffer, limits: ArchiveLimits): Promise<Result<ArchiveEntry[]>>;
}
