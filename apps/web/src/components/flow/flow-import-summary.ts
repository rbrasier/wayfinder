import type { FlowExportDependency, FlowImportInspection } from "@wayfinder/domain";

export const formatAssetSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const describeDependency = (dependency: FlowExportDependency): string =>
  dependency.kind === "skill"
    ? `Skill: ${dependency.name}`
    : `MCP tool: ${dependency.toolName} on ${dependency.name}`;

export interface InspectionSummary {
  flowName: string;
  description: string | null;
  nodeCount: number;
  assetCount: number;
  exportedFrom: string;
  files: { id: string; filename: string; size: string }[];
  found: { key: string; label: string }[];
  missing: { key: string; label: string }[];
  needsNothing: boolean;
  publishBlocked: boolean;
  warnings: string[];
}

const keyOf = (dependency: FlowExportDependency): string =>
  `${dependency.kind}-${dependency.sourceId}-${dependency.toolName ?? ""}`;

// Everything the inspection panel renders, derived in one place so the panel
// itself stays a layout and this stays testable without a browser.
export const summariseInspection = (inspection: FlowImportInspection): InspectionSummary => {
  const { manifest, resolved, unresolved, assetCount, warnings } = inspection;

  return {
    flowName: manifest.snapshot.flow.name,
    description: manifest.snapshot.flow.description,
    nodeCount: manifest.snapshot.nodes.length,
    assetCount,
    exportedFrom: manifest.exportedFrom.appVersion,
    files: manifest.assets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      size: formatAssetSize(asset.sizeBytes),
    })),
    found: resolved.map((entry) => ({
      key: keyOf(entry.dependency),
      label: describeDependency(entry.dependency),
    })),
    missing: unresolved.map((dependency) => ({
      key: keyOf(dependency),
      label: describeDependency(dependency),
    })),
    needsNothing: resolved.length === 0 && unresolved.length === 0,
    // The same condition the publish gate enforces server-side, so the panel
    // never promises an import that will then refuse to publish without warning.
    publishBlocked: unresolved.length > 0,
    warnings,
  };
};
