import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";
import type { FlowExportDependency, FlowImportResolution } from "./flow-export";
import type { FlowSnapshot, FlowSnapshotNode } from "./flow-version";

// Keyed the same way `collectDependencies` groups: a tool is identified by its
// server plus its name, a skill by its id alone.
const dependencyKey = (dependency: FlowExportDependency): string =>
  `${dependency.kind}:${dependency.sourceId}:${dependency.toolName ?? ""}`;

const isToolRef = (value: unknown): value is { serverId: string; toolName: string } => {
  if (typeof value !== "object" || value === null) return false;
  const { serverId, toolName } = value as Record<string, unknown>;
  return typeof serverId === "string" && typeof toolName === "string";
};

interface DependencyIndex {
  localIdBySource: Map<string, string>;
  unresolvedBySource: Map<string, FlowExportDependency>;
  unresolvedByNode: Map<string, FlowExportDependency[]>;
}

const indexResolution = (resolution: FlowImportResolution): DependencyIndex => {
  const localIdBySource = new Map<string, string>();
  for (const entry of resolution.resolved) {
    localIdBySource.set(dependencyKey(entry.dependency), entry.localId);
  }

  const unresolvedBySource = new Map<string, FlowExportDependency>();
  const unresolvedByNode = new Map<string, FlowExportDependency[]>();
  for (const dependency of resolution.unresolved) {
    unresolvedBySource.set(dependencyKey(dependency), dependency);
    for (const nodeId of dependency.nodeIds) {
      const forNode = unresolvedByNode.get(nodeId) ?? [];
      forNode.push(dependency);
      unresolvedByNode.set(nodeId, forNode);
    }
  }

  return { localIdBySource, unresolvedBySource, unresolvedByNode };
};

const rewriteSkillRefs = (config: Record<string, unknown>, index: DependencyIndex): unknown => {
  if (!Array.isArray(config.skillRefs)) return config.skillRefs;

  return config.skillRefs.flatMap((sourceId) => {
    if (typeof sourceId !== "string") return [];
    const localId = index.localIdBySource.get(`skill:${sourceId}:`);
    // Dropped rather than kept: a reference to a skill that does not exist here
    // would be silently ignored at prompt-build time, and the node's flag is
    // what makes the gap visible instead.
    return localId ? [localId] : [];
  });
};

const rewriteToolRefs = (config: Record<string, unknown>, index: DependencyIndex): unknown => {
  if (!Array.isArray(config.allowedMcpToolRefs)) return config.allowedMcpToolRefs;

  return config.allowedMcpToolRefs.flatMap((ref) => {
    if (!isToolRef(ref)) return [];
    const localId = index.localIdBySource.get(`mcp_tool:${ref.serverId}:${ref.toolName}`);
    // The allow-list is the enforcement boundary for MCP (ADR-032): an entry
    // that cannot be resolved must not survive, or the step would carry a
    // permission naming a server this deployment cannot vouch for.
    return localId ? [{ ...ref, serverId: localId }] : [];
  });
};

const rewriteNodeConfig = (
  node: FlowSnapshotNode,
  resolution: FlowImportResolution,
  index: DependencyIndex,
): Record<string, unknown> => {
  const config: Record<string, unknown> = { ...node.config };

  if (typeof config.documentTemplatePath === "string") {
    const key = resolution.assetKeys[config.documentTemplatePath];
    if (key) config.documentTemplatePath = key;
  }

  if (config.skillRefs !== undefined) config.skillRefs = rewriteSkillRefs(node.config, index);
  if (config.allowedMcpToolRefs !== undefined) {
    config.allowedMcpToolRefs = rewriteToolRefs(node.config, index);
  }

  const { serverId, toolName } = node.config;
  if (typeof serverId === "string" && typeof toolName === "string") {
    const localId = index.localIdBySource.get(`mcp_tool:${serverId}:${toolName}`);
    // Null rather than left in place: a foreign server id is not a working
    // config, and the node's flag plus the publish gate is what surfaces it.
    config.serverId = localId ?? null;
  }

  const unresolved = index.unresolvedByNode.get(node.id);
  if (unresolved && unresolved.length > 0) config.unresolvedDependencies = unresolved;

  return config;
};

// Turns an archive's snapshot into one this deployment can store: assets point
// at their freshly generated keys, resolved references point at local ids, and
// unresolved ones are cleared from config and recorded on the node that wanted
// them. Node ids are untouched here — the database assigns those, so they are
// remapped afterwards by `remapNodeReferences`.
//
// Pure: the input snapshot is never mutated.
export const rewriteSnapshot = (
  snapshot: FlowSnapshot,
  resolution: FlowImportResolution,
): FlowSnapshot => {
  const index = indexResolution(resolution);

  return {
    ...snapshot,
    flow: {
      ...snapshot.flow,
      contextDocs: snapshot.flow.contextDocs.map((doc) => {
        const key = resolution.assetKeys[doc.storagePath];
        return key ? { ...doc, storagePath: key } : { ...doc };
      }),
    },
    nodes: snapshot.nodes.map((node) => ({
      ...node,
      config: rewriteNodeConfig(node, resolution, index),
    })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
};

const remapStepReference = (
  value: unknown,
  nodeIdMap: Record<string, string>,
): Result<unknown> => {
  if (typeof value !== "object" || value === null) return ok(value);

  const reference = value as Record<string, unknown>;
  if (reference.kind !== "step") return ok(value);
  // An absent or null nodeId means "the last completed step", which is a rule
  // rather than a reference — there is nothing to remap.
  if (typeof reference.nodeId !== "string") return ok(value);

  const mapped = nodeIdMap[reference.nodeId];
  if (!mapped) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `An approval step points at node "${reference.nodeId}", which is not part of this flow.`,
      ),
    );
  }

  return ok({ ...reference, nodeId: mapped });
};

// Rewrites every node id in the snapshot to the id its row was actually given,
// along with everything that refers to one: both ends of every edge, and the
// node ids embedded in approval config (`approvalSubject`,
// `changesRequestedTarget`). Missing those last two would leave an imported
// approval step pointing at a node that does not exist, and a
// `changes_requested` decision would quietly fall back to the nearest editable
// step instead of the one the author chose.
//
// Pure: the input snapshot is never mutated.
export const remapNodeReferences = (
  snapshot: FlowSnapshot,
  nodeIdMap: Record<string, string>,
): Result<FlowSnapshot> => {
  const nodes: FlowSnapshotNode[] = [];

  for (const node of snapshot.nodes) {
    const mappedId = nodeIdMap[node.id];
    if (!mappedId) {
      return err(
        domainError("VALIDATION_FAILED", `No new id was allocated for node "${node.id}".`),
      );
    }

    const config: Record<string, unknown> = { ...node.config };

    for (const field of ["approvalSubject", "changesRequestedTarget"] as const) {
      if (config[field] === undefined) continue;
      const remapped = remapStepReference(config[field], nodeIdMap);
      if (remapped.error) return remapped;
      config[field] = remapped.data;
    }

    nodes.push({ ...node, id: mappedId, config });
  }

  const edges: FlowSnapshot["edges"] = [];

  for (const edge of snapshot.edges) {
    const fromNodeId = nodeIdMap[edge.fromNodeId];
    const toNodeId = nodeIdMap[edge.toNodeId];
    if (!fromNodeId || !toNodeId) {
      const orphan = fromNodeId ? edge.toNodeId : edge.fromNodeId;
      return err(
        domainError(
          "VALIDATION_FAILED",
          `Edge "${edge.id}" points at node "${orphan}", which is not part of this flow.`,
        ),
      );
    }

    edges.push({ ...edge, fromNodeId, toNodeId });
  }

  return ok({ ...snapshot, flow: { ...snapshot.flow }, nodes, edges });
};
