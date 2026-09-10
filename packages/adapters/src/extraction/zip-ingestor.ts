import { domainError, err, ok } from "@wayfinder/domain";
import type { ArchiveEntry, ArchiveLimits, IArchiveExtractor, Result } from "@wayfinder/domain";
import {
  decompressionBomb,
  guardDeclaredSizes,
  guardEntryCount,
  isUnsafePath,
  openZip,
  readableEntries,
  tooLargeEntry,
  unsafeEntryPath,
} from "../archives/zip-guards";
import { sniffMimeType } from "./mime-sniff";

// Safe, tree-preserving zip expansion (ADR-033 §5, phase §2). The four hard
// guards — entry count, per-entry size, decompression bomb, and zip-slip — live
// in `archives/zip-guards.ts` and are shared with the flow-archive reader. What
// is specific to this ingestor is the MIME policy: entries are sniffed from
// content and anything unrecognised is skipped rather than trusted.
//
// Never throws: a malformed or unsafe archive comes back as a DomainError.
export class ZipIngestor implements IArchiveExtractor {
  async expand(archive: Buffer, limits: ArchiveLimits): Promise<Result<ArchiveEntry[]>> {
    const zip = openZip(archive);
    if (zip.error) return err(zip.error);

    const files = readableEntries(zip.data);

    const countGuard = guardEntryCount(files, limits.maxEntries);
    if (countGuard.error) return err(countGuard.error);

    const declaredGuard = guardDeclaredSizes(files, limits);
    if (declaredGuard.error) return err(declaredGuard.error);

    const entries: ArchiveEntry[] = [];
    let totalBytes = 0;

    for (const entry of files) {
      if (isUnsafePath(entry.name)) return unsafeEntryPath(entry.name);

      const buffer = Buffer.from(entry.asNodeBuffer());
      if (buffer.length > limits.maxEntryBytes) return tooLargeEntry(entry.name, limits.maxEntryBytes);
      totalBytes += buffer.length;
      if (totalBytes > limits.maxTotalBytes) return decompressionBomb(limits.maxTotalBytes);

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
}
