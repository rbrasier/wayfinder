import type { FlowSnapshot } from "./flow-version";

// The archive format's own version, independent of the app version. Bumped only
// when the manifest shape changes in a way a previous reader cannot understand.
// An archive above this is refused outright rather than half-read (ADR-049 §8).
export const FLOW_EXPORT_FORMAT_VERSION = 1;

// The oldest format this deployment still reads. Anything below it is refused
// rather than migrated, so the migration chain never has to reach back further
// than the code that is still maintained.
export const MIN_SUPPORTED_FORMAT_VERSION = 1;

export type FlowExportAssetKind = "template" | "context_doc";

// One binary carried alongside the manifest. `id` is the entry name under
// `assets/` and is assigned by the exporter, never taken from a filename.
export interface FlowExportAsset {
  id: string;
  kind: FlowExportAssetKind;
  // The asset's object-storage key in the *source* deployment. It exists so the
  // importer can find which snapshot field referred to this asset and repoint
  // it. It is never used as a write path — the importer generates its own key,
  // which is what makes zip-slip structurally impossible (ADR-049 §7).
  path: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  // Lowercase hex, verified on read. A mismatch fails the import rather than
  // storing the bytes.
  sha256: string;
}

// What the flow needs from its host deployment. There is no `kb_collection`
// kind: the product has no collection concept, and a flow's knowledge travels
// as context-document assets (ADR-049 §3).
export type FlowExportDependencyKind = "skill" | "mcp_tool";

export interface FlowExportDependency {
  kind: FlowExportDependencyKind;
  // The *exporting* deployment's id for this record. It exists only as a join
  // key back into the embedded snapshot, whose node config holds ids verbatim
  // (ADR-049 §2) — without it nothing links `skillRefs: ["<id>"]` to the named
  // dependency describing it. It is never looked up in the importing
  // deployment: resolution is by `name`, and this id means nothing here.
  sourceId: string;
  // `app_skills.name` for a skill; `admin_mcp_servers.label` for an MCP tool.
  // Neither column is unique, which is why an ambiguous match resolves to
  // nothing rather than to a guess.
  name: string;
  // Set for `mcp_tool` only.
  toolName?: string;
  // Every node that referenced this dependency, so the importer can flag them
  // all when it does not resolve.
  nodeIds: string[];
}

export interface FlowExportManifest {
  formatVersion: number;
  exportedAt: string;
  exportedFrom: { appVersion: string };
  // Embedded verbatim (ADR-049 §2), so a field added to any node config travels
  // without this feature knowing it exists.
  snapshot: FlowSnapshot;
  dependencies: FlowExportDependency[];
  assets: FlowExportAsset[];
}

// A dependency matched to exactly one local record.
export interface ResolvedFlowDependency {
  dependency: FlowExportDependency;
  // `app_skills.id` for a skill; `admin_mcp_servers.id` for an MCP tool.
  localId: string;
}

// What `inspectFlowImport` reports before anything is written.
export interface FlowImportInspection {
  manifest: FlowExportManifest;
  resolved: ResolvedFlowDependency[];
  unresolved: FlowExportDependency[];
  assetCount: number;
  // Human-readable notes that do not block the import — an ambiguous name, an
  // asset kind the app no longer generates.
  warnings: string[];
}

// Everything the pure rewrite needs to turn an archive's snapshot into one this
// deployment can store.
export interface FlowImportResolution {
  resolved: ResolvedFlowDependency[];
  unresolved: FlowExportDependency[];
  // Source `FlowExportAsset.path` → the freshly generated local storage key.
  assetKeys: Record<string, string>;
}
