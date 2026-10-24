import type { Node } from "@xyflow/react";
import { emailConfigsAfterRename } from "@rbrasier/domain";

interface CanvasNodeData {
  name?: string;
  config?: Record<string, unknown>;
}

// The server rewrites Email steps' tags when a step they use is renamed
// (UpdateFlowNode). The canvas applies the same rewrite to its copy, so an Email
// step reopened before the next load shows — and re-saves — the new tags.
// `nodes` must still carry the renamed step's previous name.
export const followRenameOnCanvas = (nodes: Node[], nodeId: string, newName: string): Node[] => {
  const rewrites = emailConfigsAfterRename(
    nodes.map((candidate) => {
      const data = candidate.data as CanvasNodeData;
      return {
        id: candidate.id,
        name: data.name ?? "",
        type: candidate.type === "emailNode" ? "email" : (candidate.type ?? ""),
        config: data.config ?? {},
      };
    }),
    nodeId,
    newName,
  );
  if (rewrites.length === 0) return nodes;
  const configById = new Map(rewrites.map((rewrite) => [rewrite.nodeId, rewrite.config]));
  return nodes.map((candidate) => {
    const config = configById.get(candidate.id);
    return config ? { ...candidate, data: { ...candidate.data, config } } : candidate;
  });
};
