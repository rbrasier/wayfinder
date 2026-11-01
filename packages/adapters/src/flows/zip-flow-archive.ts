import { createHash } from "node:crypto";
import PizZip from "pizzip";
import { domainError, err, migrateManifest, ok, validateManifest } from "@wayfinder/domain";
import type {
  FlowArchiveAsset,
  FlowArchiveContents,
  FlowArchiveLimits,
  FlowExportManifest,
  IFlowArchiveReader,
  IFlowArchiveWriter,
  Result,
} from "@wayfinder/domain";
import {
  decompressionBomb,
  guardDeclaredSizes,
  isUnsafePath,
  openZip,
  readableEntries,
  tooLargeEntry,
  unsafeEntryPath,
} from "../archives/zip-guards";

const MANIFEST_ENTRY = "manifest.json";
const ASSET_PREFIX = "assets/";

const invalid = (message: string, cause?: unknown): Result<never> =>
  err(domainError("VALIDATION_FAILED", message, cause));

const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

// Reads and writes the flow archive: `manifest.json` plus `assets/<id>`.
//
// This is a second zip reader alongside `ZipIngestor`, and deliberately so
// (ADR-049 §10): the ingestor sniffs each entry's MIME and skips what it cannot
// recognise, which would silently discard `manifest.json` and every `.xlsx`
// template. The two share their safety guards — `archives/zip-guards.ts` — so
// there is still only one zip-slip implementation in the codebase.
//
// Never throws. Every failure path returns a DomainError.
export class ZipFlowArchive implements IFlowArchiveWriter, IFlowArchiveReader {
  async write(
    manifest: FlowExportManifest,
    assets: FlowArchiveAsset[],
  ): Promise<Result<Buffer>> {
    try {
      const zip = new PizZip();
      zip.file(MANIFEST_ENTRY, JSON.stringify(manifest, null, 2));

      // Keyed by the manifest-assigned id, never by a filename. The filename is
      // carried in the manifest as metadata and is never a path on either side.
      for (const entry of assets) {
        zip.file(`${ASSET_PREFIX}${entry.asset.id}`, entry.bytes);
      }

      return ok(zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "The flow archive could not be written.", cause));
    }
  }

  async read(
    archive: Buffer,
    limits: FlowArchiveLimits,
  ): Promise<Result<FlowArchiveContents>> {
    if (archive.length > limits.maxArchiveBytes) {
      return invalid(
        `The archive is ${archive.length} bytes, over the ${limits.maxArchiveBytes}-byte limit.`,
      );
    }

    const zip = openZip(archive);
    if (zip.error) return err(zip.error);

    const entries = readableEntries(zip.data);

    // Every path is checked before anything is decompressed. Nothing in this
    // reader ever writes to a path from the archive — assets are re-keyed by the
    // importer — but an escaping entry still means the archive is hostile, and
    // an archive that tries is refused rather than partially trusted.
    for (const entry of entries) {
      if (isUnsafePath(entry.name)) return unsafeEntryPath(entry.name);
    }

    const assetEntries = entries.filter((entry) => entry.name !== MANIFEST_ENTRY);
    if (assetEntries.length > limits.maxAssetCount) {
      return invalid(
        `The archive holds ${assetEntries.length} assets, over the ${limits.maxAssetCount}-asset limit.`,
      );
    }

    const declaredGuard = guardDeclaredSizes(entries, {
      maxEntryBytes: limits.maxAssetBytes,
      maxTotalBytes: limits.maxUncompressedBytes,
    });
    if (declaredGuard.error) return err(declaredGuard.error);

    const manifestEntry = zip.data.files[MANIFEST_ENTRY];
    if (!manifestEntry || manifestEntry.dir) {
      return invalid("The archive has no manifest.json and is not a flow export.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(manifestEntry.asText());
    } catch (cause) {
      return invalid("The archive's manifest.json is not valid JSON.", cause);
    }

    const validated = validateManifest(parsed);
    if (validated.error) return err(validated.error);

    const migrated = migrateManifest(validated.data);
    if (migrated.error) return err(migrated.error);

    const manifest = migrated.data;
    const assets = new Map<string, Buffer>();
    let totalBytes = 0;

    for (const asset of manifest.assets) {
      const entry = zip.data.files[`${ASSET_PREFIX}${asset.id}`];
      if (!entry || entry.dir) {
        return invalid(`The manifest lists asset "${asset.id}" but the archive does not contain it.`);
      }

      const bytes = Buffer.from(entry.asNodeBuffer());
      if (bytes.length > limits.maxAssetBytes) return tooLargeEntry(entry.name, limits.maxAssetBytes);

      totalBytes += bytes.length;
      if (totalBytes > limits.maxUncompressedBytes) {
        return decompressionBomb(limits.maxUncompressedBytes);
      }

      const digest = sha256Of(bytes);
      if (digest !== asset.sha256) {
        return invalid(
          `Asset "${asset.filename}" failed its sha256 check — the archive has been altered or is corrupt.`,
        );
      }

      assets.set(asset.id, bytes);
    }

    return ok({ manifest, assets });
  }
}
