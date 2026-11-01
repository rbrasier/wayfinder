import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import {
  FLOW_EXPORT_FORMAT_VERSION,
  MIN_SUPPORTED_FORMAT_VERSION,
  type FlowExportAsset,
  type FlowExportDependency,
  type FlowExportManifest,
} from "./flow-export";

const MANIFEST_FIELDS = [
  "formatVersion",
  "exportedAt",
  "exportedFrom",
  "snapshot",
  "dependencies",
  "assets",
] as const;

const ASSET_KINDS = new Set(["template", "context_doc"]);
const DEPENDENCY_KINDS = new Set(["skill", "mcp_tool"]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const invalid = (message: string): Result<never> =>
  err(domainError("VALIDATION_FAILED", message));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, field: string): Result<string> => {
  if (typeof value !== "string") return invalid(`Manifest field "${field}" must be a string.`);
  if (value.trim() === "") return invalid(`Manifest field "${field}" must not be empty.`);
  return ok(value);
};

const validateFormatVersion = (value: unknown): Result<number> => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return invalid(`Manifest field "formatVersion" must be a whole number.`);
  }
  if (value > FLOW_EXPORT_FORMAT_VERSION) {
    return invalid(
      `This archive was written in flow export format ${value}, and this deployment reads up to format ${FLOW_EXPORT_FORMAT_VERSION}. Upgrade Wayfinder, or export the flow again from a deployment on this version.`,
    );
  }
  if (value < MIN_SUPPORTED_FORMAT_VERSION) {
    return invalid(
      `This archive was written in flow export format ${value}, which is older than the oldest format this deployment reads (${MIN_SUPPORTED_FORMAT_VERSION}).`,
    );
  }
  return ok(value);
};

// The snapshot is embedded verbatim, so this checks only the frame every reader
// depends on. Anything deeper belongs to whichever node type owns it, and
// validating it here would defeat the point of embedding it (ADR-049 §2).
const validateSnapshotFrame = (value: unknown): Result<FlowExportManifest["snapshot"]> => {
  if (!isRecord(value)) return invalid(`Manifest field "snapshot" must be an object.`);
  if (!isRecord(value.flow)) return invalid(`Manifest field "snapshot.flow" must be an object.`);

  const name = requireString(value.flow.name, "snapshot.flow.name");
  if (name.error) return name;

  if (!Array.isArray(value.nodes)) return invalid(`Manifest field "snapshot.nodes" must be an array.`);
  if (!Array.isArray(value.edges)) return invalid(`Manifest field "snapshot.edges" must be an array.`);

  return ok(value as unknown as FlowExportManifest["snapshot"]);
};

const validateDependency = (value: unknown, index: number): Result<FlowExportDependency> => {
  const at = `dependencies[${index}]`;
  if (!isRecord(value)) return invalid(`Manifest field "${at}" must be an object.`);

  if (typeof value.kind !== "string" || !DEPENDENCY_KINDS.has(value.kind)) {
    return invalid(`Manifest field "${at}.kind" must be one of: skill, mcp_tool.`);
  }

  for (const field of ["sourceId", "name"] as const) {
    const checked = requireString(value[field], `${at}.${field}`);
    if (checked.error) return checked;
  }

  if (value.kind === "mcp_tool") {
    const toolName = requireString(value.toolName, `${at}.toolName`);
    if (toolName.error) return toolName;
  }

  if (!Array.isArray(value.nodeIds) || value.nodeIds.some((id) => typeof id !== "string")) {
    return invalid(`Manifest field "${at}.nodeIds" must be an array of strings.`);
  }

  return ok(value as unknown as FlowExportDependency);
};

const validateAsset = (value: unknown, index: number): Result<FlowExportAsset> => {
  const at = `assets[${index}]`;
  if (!isRecord(value)) return invalid(`Manifest field "${at}" must be an object.`);

  if (typeof value.kind !== "string" || !ASSET_KINDS.has(value.kind)) {
    return invalid(`Manifest field "${at}.kind" must be one of: template, context_doc.`);
  }

  for (const field of ["id", "path", "filename", "mimeType"] as const) {
    const checked = requireString(value[field], `${at}.${field}`);
    if (checked.error) return checked;
  }

  if (typeof value.sizeBytes !== "number" || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0) {
    return invalid(`Manifest field "${at}.sizeBytes" must be a whole number of bytes, zero or more.`);
  }

  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256)) {
    return invalid(`Manifest field "${at}.sha256" must be a 64-character lowercase hex digest.`);
  }

  return ok(value as unknown as FlowExportAsset);
};

// Schema-validates an archive's manifest before any field is read (ADR-049 §7).
// Unknown top-level fields are refused rather than ignored: `formatVersion` is
// how a newer archive announces itself, so an unrecognised key means the archive
// is not what it claims to be.
export const validateManifest = (value: unknown): Result<FlowExportManifest> => {
  if (!isRecord(value)) return invalid("A flow archive manifest must be a JSON object.");

  const unexpected = Object.keys(value).filter(
    (key) => !(MANIFEST_FIELDS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0) {
    return invalid(`Manifest holds unexpected field(s): ${unexpected.join(", ")}.`);
  }

  const missing = MANIFEST_FIELDS.filter((field) => value[field] === undefined);
  if (missing.length > 0) {
    return invalid(`Manifest is missing required field(s): ${missing.join(", ")}.`);
  }

  const formatVersion = validateFormatVersion(value.formatVersion);
  if (formatVersion.error) return formatVersion;

  const exportedAt = requireString(value.exportedAt, "exportedAt");
  if (exportedAt.error) return exportedAt;

  if (!isRecord(value.exportedFrom)) return invalid(`Manifest field "exportedFrom" must be an object.`);
  const appVersion = requireString(value.exportedFrom.appVersion, "exportedFrom.appVersion");
  if (appVersion.error) return appVersion;

  const snapshot = validateSnapshotFrame(value.snapshot);
  if (snapshot.error) return snapshot;

  if (!Array.isArray(value.dependencies)) return invalid(`Manifest field "dependencies" must be an array.`);
  const dependencies: FlowExportDependency[] = [];
  for (const [index, entry] of value.dependencies.entries()) {
    const dependency = validateDependency(entry, index);
    if (dependency.error) return dependency;
    dependencies.push(dependency.data);
  }

  if (!Array.isArray(value.assets)) return invalid(`Manifest field "assets" must be an array.`);
  const assets: FlowExportAsset[] = [];
  for (const [index, entry] of value.assets.entries()) {
    const asset = validateAsset(entry, index);
    if (asset.error) return asset;
    assets.push(asset.data);
  }

  return ok({
    formatVersion: formatVersion.data,
    exportedAt: exportedAt.data,
    exportedFrom: { appVersion: appVersion.data },
    snapshot: snapshot.data,
    dependencies,
    assets,
  });
};

// One step up the format chain. A migration only ever reads the shape its
// `fromVersion` describes and returns the next one, so a chain of small steps
// replaces a set of version-aware branches scattered through the readers.
export interface ManifestMigration {
  fromVersion: number;
  apply: (manifest: FlowExportManifest) => FlowExportManifest;
}

// Empty until format 2 exists. The first real migration adds an entry here and a
// case to the test alongside it; the walk itself is already covered.
export const MANIFEST_MIGRATIONS: ManifestMigration[] = [];

// Brings an older manifest up to the current format, one step at a time. Newer
// archives never reach this — `validateManifest` has already refused them.
export const migrateManifest = (
  manifest: FlowExportManifest,
  migrations: ManifestMigration[] = MANIFEST_MIGRATIONS,
  targetVersion: number = FLOW_EXPORT_FORMAT_VERSION,
): Result<FlowExportManifest> => {
  let migrated = manifest;

  while (migrated.formatVersion < targetVersion) {
    const step = migrations.find((candidate) => candidate.fromVersion === migrated.formatVersion);
    if (!step) {
      return invalid(
        `No migration exists from flow export format ${migrated.formatVersion} to ${targetVersion}. The archive cannot be read by this deployment.`,
      );
    }

    const next = step.apply(migrated);
    if (next.formatVersion <= migrated.formatVersion) {
      return invalid(
        `Migration from flow export format ${migrated.formatVersion} did not advance the version.`,
      );
    }
    migrated = next;
  }

  return ok(migrated);
};
