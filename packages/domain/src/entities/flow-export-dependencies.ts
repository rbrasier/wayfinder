import type { FlowExportDependencyKind } from "./flow-export";
import type { FlowSnapshot } from "./flow-version";

// A dependency as the snapshot carries it — by local id, because that is all a
// stored flow holds. Turning `localId` into the portable name (`app_skills.name`
// or `admin_mcp_servers.label`) needs a repository, so it happens in the export
// use-case; the domain has none and stays pure.
export interface FlowDependencyRef {
  kind: FlowExportDependencyKind;
  localId: string;
  // Set for `mcp_tool` only.
  toolName?: string;
  nodeIds: string[];
}

const dependencyKey = (kind: FlowExportDependencyKind, localId: string, toolName?: string): string =>
  `${kind}:${localId}:${toolName ?? ""}`;

const stringsOf = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
};

const toolRefsOf = (value: unknown): { serverId: string; toolName: string }[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { serverId, toolName } = entry as Record<string, unknown>;
    if (typeof serverId !== "string" || serverId === "") return [];
    if (typeof toolName !== "string" || toolName === "") return [];
    return [{ serverId, toolName }];
  });
};

// Walks a snapshot for everything it needs from its host deployment: library
// skills applied to a step, MCP tools a conversational step may call, and the
// single tool a deterministic MCP node calls. An inline skill is embedded in the
// snapshot and needs nothing; an approval node resolves its approver from the
// directory at runtime and so carries no reference either (ADR-049 §3).
//
// Config is read defensively — a snapshot is a jsonb blob that may have been
// written by an older or newer authoring surface, and a malformed entry is
// skipped rather than thrown on.
export const collectDependencies = (snapshot: FlowSnapshot): FlowDependencyRef[] => {
  const byKey = new Map<string, FlowDependencyRef>();

  const record = (
    kind: FlowExportDependencyKind,
    localId: string,
    nodeId: string,
    toolName?: string,
  ): void => {
    const key = dependencyKey(kind, localId, toolName);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        kind,
        localId,
        ...(toolName === undefined ? {} : { toolName }),
        nodeIds: [nodeId],
      });
      return;
    }

    if (!existing.nodeIds.includes(nodeId)) existing.nodeIds.push(nodeId);
  };

  for (const node of snapshot.nodes) {
    for (const skillId of stringsOf(node.config.skillRefs)) {
      record("skill", skillId, node.id);
    }

    for (const ref of toolRefsOf(node.config.allowedMcpToolRefs)) {
      record("mcp_tool", ref.serverId, node.id, ref.toolName);
    }

    const { serverId, toolName } = node.config;
    if (typeof serverId === "string" && serverId !== "" && typeof toolName === "string" && toolName !== "") {
      record("mcp_tool", serverId, node.id, toolName);
    }
  }

  return [...byKey.values()];
};
