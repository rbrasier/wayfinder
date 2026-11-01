import type { FlowExportDependency } from "@wayfinder/domain";

// Node config is jsonb and may have been written by any authoring surface, so
// the flag is read defensively rather than trusted.
export const unresolvedDependenciesOf = (
  config: Record<string, unknown>,
): FlowExportDependency[] => {
  const value = config.unresolvedDependencies;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is FlowExportDependency =>
      typeof entry === "object" && entry !== null && typeof (entry as { name?: unknown }).name === "string",
  );
};

const describe = (dependency: FlowExportDependency): string =>
  dependency.kind === "skill"
    ? `skill "${dependency.name}"`
    : `MCP tool "${dependency.toolName}" on "${dependency.name}"`;

export interface UnresolvedBadgeModel {
  count: number;
  label: string;
  title: string;
}

// Null means the node is fine and no badge is drawn.
export const unresolvedBadgeModel = (
  config: Record<string, unknown>,
): UnresolvedBadgeModel | null => {
  const unresolved = unresolvedDependenciesOf(config);
  if (unresolved.length === 0) return null;

  return {
    count: unresolved.length,
    label: unresolved.length === 1 ? "1 missing reference" : `${unresolved.length} missing references`,
    title: `Missing: ${unresolved.map(describe).join(", ")}`,
  };
};
