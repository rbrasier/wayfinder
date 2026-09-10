import PizZip from "pizzip";
import { domainError, err, ok } from "@wayfinder/domain";
import type { Result } from "@wayfinder/domain";

// PizZip exposes the central-directory uncompressed size on a private field. We
// read it (best-effort) to reject an oversized entry before decompressing it, so
// a decompression bomb never gets allocated in the first place.
interface CompressedMeta {
  _data?: { uncompressedSize?: number | null };
}

export interface DeclaredSizeLimits {
  maxEntryBytes: number;
  maxTotalBytes: number;
}

const declaredUncompressedSize = (entry: PizZip.ZipObject): number | null => {
  const size = (entry as unknown as CompressedMeta)._data?.uncompressedSize;
  return typeof size === "number" ? size : null;
};

// Zip-slip guard: reject absolute paths, Windows drive letters, and any parent
// segment so a crafted entry can never escape its extraction root.
//
// This is the single implementation. Both archive readers — extraction intake
// and flow import — call it, because two copies of this check is how one of them
// ends up subtly wrong.
export const isUnsafePath = (name: string): boolean => {
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:/.test(name)) return true;
  return name
    .replace(/\\/g, "/")
    .split("/")
    .some((segment) => segment === "..");
};

export const tooLargeEntry = (name: string, limit: number): Result<never> =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `Archive entry "${name}" exceeds the ${limit}-byte per-file limit.`,
    ),
  );

export const decompressionBomb = (limit: number): Result<never> =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `The archive decompresses to more than the ${limit}-byte total limit (possible decompression bomb).`,
    ),
  );

export const unsafeEntryPath = (name: string): Result<never> =>
  err(
    domainError(
      "VALIDATION_FAILED",
      `Archive entry "${name}" has an unsafe path and was rejected.`,
    ),
  );

// Opens an untrusted archive without throwing.
export const openZip = (archive: Buffer): Result<PizZip> => {
  try {
    return ok(new PizZip(archive, { checkCRC32: false }));
  } catch (cause) {
    return err(
      domainError("VALIDATION_FAILED", "The uploaded archive is not a readable zip file.", cause),
    );
  }
};

// The archive's files, with directory entries left out.
export const readableEntries = (zip: PizZip): PizZip.ZipObject[] =>
  Object.values(zip.files).filter((entry) => !entry.dir);

export const guardEntryCount = (
  entries: PizZip.ZipObject[],
  maxEntries: number,
): Result<void> => {
  if (entries.length > maxEntries) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `The archive holds ${entries.length} files, over the ${maxEntries}-file limit.`,
      ),
    );
  }
  return ok(undefined);
};

// Rejects an oversized or bomb archive from the central directory's declared
// sizes, before any entry is decompressed.
export const guardDeclaredSizes = (
  entries: PizZip.ZipObject[],
  limits: DeclaredSizeLimits,
): Result<void> => {
  let declaredTotal = 0;

  for (const entry of entries) {
    const declared = declaredUncompressedSize(entry);
    if (declared === null) continue;
    if (declared > limits.maxEntryBytes) return tooLargeEntry(entry.name, limits.maxEntryBytes);
    declaredTotal += declared;
    if (declaredTotal > limits.maxTotalBytes) return decompressionBomb(limits.maxTotalBytes);
  }

  return ok(undefined);
};
