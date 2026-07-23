import PizZip from "pizzip";
import { domainError, err, ok } from "@rbrasier/domain";
import type { ArchiveEntry, ArchiveLimits, IArchiveExtractor, Result } from "@rbrasier/domain";
import { sniffMimeType } from "./mime-sniff";

// PizZip exposes the central-directory uncompressed size on a private field. We
// read it (best-effort) to reject an oversized entry before decompressing it, so
// a decompression bomb never gets allocated in the first place.
interface CompressedMeta {
  _data?: { uncompressedSize?: number | null };
}

const declaredUncompressedSize = (entry: PizZip.ZipObject): number | null => {
  const size = (entry as unknown as CompressedMeta)._data?.uncompressedSize;
  return typeof size === "number" ? size : null;
};

// Zip-slip guard: reject absolute paths, Windows drive letters, and any parent
// segment so a crafted entry can never escape its extraction root (phase §5).
const isUnsafePath = (name: string): boolean => {
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:/.test(name)) return true;
  return name
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "..");
};

const tooLarge = (name: string, limit: number): Result<never> =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `Archive entry "${name}" exceeds the ${limit}-byte per-file limit.`,
    ),
  );

const bomb = (limit: number): Result<never> =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `The archive decompresses to more than the ${limit}-byte total limit (possible decompression bomb).`,
    ),
  );

// Safe, tree-preserving zip expansion (ADR-033 §5, phase §2). Enforces the four
// hard guards — entry count, per-entry size, decompression bomb, and zip-slip —
// and sniffs MIME from content. Unrecognised entries are skipped rather than
// trusted. Never throws: a malformed or unsafe archive comes back as a
// DomainError.
export class ZipIngestor implements IArchiveExtractor {
  async expand(archive: Buffer, limits: ArchiveLimits): Promise<Result<ArchiveEntry[]>> {
    let zip: PizZip;
    try {
      zip = new PizZip(archive, { checkCRC32: false });
    } catch (cause) {
      return err(
        domainError("VALIDATION_FAILED", "The uploaded archive is not a readable zip file.", cause),
      );
    }

    const files = Object.values(zip.files).filter((entry) => !entry.dir);
    if (files.length > limits.maxEntries) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          `The archive holds ${files.length} files, over the ${limits.maxEntries}-file limit.`,
        ),
      );
    }

    const declaredGuard = this.guardDeclaredSizes(files, limits);
    if (declaredGuard.error) return declaredGuard;

    const entries: ArchiveEntry[] = [];
    let totalBytes = 0;
    for (const entry of files) {
      if (isUnsafePath(entry.name)) {
        return err(
          domainError(
            "VALIDATION_FAILED",
            `Archive entry "${entry.name}" has an unsafe path and was rejected.`,
          ),
        );
      }

      const buffer = Buffer.from(entry.asNodeBuffer());
      if (buffer.length > limits.maxEntryBytes) return tooLarge(entry.name, limits.maxEntryBytes);
      totalBytes += buffer.length;
      if (totalBytes > limits.maxTotalBytes) return bomb(limits.maxTotalBytes);

      const treePath = entry.name.replace(/\\/g, "/");
      const filename = treePath.split("/").pop() ?? treePath;
      const mimeType = sniffMimeType(buffer, filename);
      if (!mimeType) continue;

      entries.push({ filename, treePath, mimeType, buffer });
    }

    if (entries.length === 0) {
      return err(
        domainError(
          "VALIDATION_FAILED",
          "The archive contained no supported documents (PDF, DOCX, or text).",
        ),
      );
    }

    return ok(entries);
  }

  // Rejects an oversized or bomb archive from the central directory's declared
  // sizes, before any entry is decompressed.
  private guardDeclaredSizes(files: PizZip.ZipObject[], limits: ArchiveLimits): Result<void> {
    let declaredTotal = 0;
    for (const entry of files) {
      const declared = declaredUncompressedSize(entry);
      if (declared === null) continue;
      if (declared > limits.maxEntryBytes) return tooLarge(entry.name, limits.maxEntryBytes);
      declaredTotal += declared;
      if (declaredTotal > limits.maxTotalBytes) return bomb(limits.maxTotalBytes);
    }
    return ok(undefined);
  }
}
