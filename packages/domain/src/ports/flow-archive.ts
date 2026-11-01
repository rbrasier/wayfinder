import type { FlowExportAsset, FlowExportManifest } from "../entities/flow-export";
import type { Result } from "../result";

// Hard safety limits for reading an archive, all enforced before extraction
// (ADR-049 §7). They are what bounds peak memory: assets are buffered rather
// than streamed, because `IObjectStorage.get` returns a whole Buffer.
export interface FlowArchiveLimits {
  // The compressed archive itself. Also enforced at the upload route, before a
  // reader is handed anything.
  maxArchiveBytes: number;
  // Total decompressed bytes across all entries — the decompression-bomb guard.
  maxUncompressedBytes: number;
  maxAssetCount: number;
  maxAssetBytes: number;
}

// Defaults for a flow archive. `maxAssetBytes` matches the extraction intake's
// existing per-entry cap so one uploaded document does not have two different
// size limits depending on which door it came through.
export const FLOW_ARCHIVE_LIMITS: FlowArchiveLimits = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxAssetCount: 100,
  maxAssetBytes: 25 * 1024 * 1024,
};

// An asset paired with its bytes, on the way into or out of an archive. `asset`
// is the manifest entry; `bytes` is what lands at `assets/<asset.id>`.
export interface FlowArchiveAsset {
  asset: FlowExportAsset;
  bytes: Buffer;
}

export interface FlowArchiveContents {
  manifest: FlowExportManifest;
  // Keyed by `FlowExportAsset.id`. Every manifest asset is present and its
  // `sha256` has already been verified, so a caller never re-checks.
  assets: Map<string, Buffer>;
}

// Writes the download. The manifest is serialised as `manifest.json`; each asset
// lands at `assets/<id>` under its manifest-assigned id, never under a filename
// taken from user input.
export interface IFlowArchiveWriter {
  write(manifest: FlowExportManifest, assets: FlowArchiveAsset[]): Promise<Result<Buffer>>;
}

// Reads an untrusted archive. Never throws: a malformed zip, a missing or
// invalid manifest, a breached ceiling, an unsafe entry path or a `sha256`
// mismatch all come back as a DomainError.
export interface IFlowArchiveReader {
  read(archive: Buffer, limits: FlowArchiveLimits): Promise<Result<FlowArchiveContents>>;
}
