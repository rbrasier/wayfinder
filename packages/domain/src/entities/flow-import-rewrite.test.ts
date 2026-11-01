import { describe, expect, it } from "vitest";
import type { FlowExportDependency, FlowImportResolution } from "./flow-export";
import { remapNodeReferences, rewriteSnapshot } from "./flow-import-rewrite";
import type { FlowSnapshot, FlowSnapshotNode } from "./flow-version";

const node = (
  id: string,
  type: FlowSnapshotNode["type"],
  config: Record<string, unknown>,
): FlowSnapshotNode => ({
  id,
  type,
  name: `Step ${id}`,
  colour: null,
  positionX: 10,
  positionY: 20,
  config,
});

const snapshotOf = (
  nodes: FlowSnapshotNode[],
  edges: FlowSnapshot["edges"] = [],
  contextDocs: FlowSnapshot["flow"]["contextDocs"] = [],
): FlowSnapshot => ({
  kind: "guided",
  flow: { name: "Flow", description: null, icon: null, expertRole: null, contextDocs },
  nodes,
  edges,
});

const skillDependency = (sourceId: string, name: string, nodeIds: string[]): FlowExportDependency => ({
  kind: "skill",
  sourceId,
  name,
  nodeIds,
});

const toolDependency = (
  sourceId: string,
  name: string,
  toolName: string,
  nodeIds: string[],
): FlowExportDependency => ({ kind: "mcp_tool", sourceId, name, toolName, nodeIds });

const emptyResolution: FlowImportResolution = { resolved: [], unresolved: [], assetKeys: {} };

describe("rewriteSnapshot — assets", () => {
  it("repoints a node's document template at its freshly stored key", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { documentTemplatePath: "source/templates/order.docx" }),
    ]);

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      assetKeys: { "source/templates/order.docx": "flows/new-flow/assets/generated-key" },
    });

    expect(rewritten.nodes[0]!.config.documentTemplatePath).toBe("flows/new-flow/assets/generated-key");
  });

  it("repoints every context document on the flow", () => {
    const snapshot = snapshotOf(
      [],
      [],
      [
        {
          id: "doc-1",
          filename: "policy.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          storagePath: "source/docs/policy.pdf",
          extractedText: "text",
          extractionStatus: "complete",
        },
      ],
    );

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      assetKeys: { "source/docs/policy.pdf": "flows/new-flow/assets/doc-key" },
    });

    expect(rewritten.flow.contextDocs[0]!.storagePath).toBe("flows/new-flow/assets/doc-key");
  });

  it("leaves a template path alone when no asset was bundled for it", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { documentTemplatePath: "source/templates/order.docx" }),
    ]);

    const rewritten = rewriteSnapshot(snapshot, emptyResolution);

    expect(rewritten.nodes[0]!.config.documentTemplatePath).toBe("source/templates/order.docx");
  });
});

describe("rewriteSnapshot — resolved dependencies", () => {
  it("rewrites a skill reference to the local skill id", () => {
    const snapshot = snapshotOf([node("node-1", "conversational", { skillRefs: ["source-skill"] })]);
    const dependency = skillDependency("source-skill", "Procurement Policy", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      resolved: [{ dependency, localId: "local-skill" }],
    });

    expect(rewritten.nodes[0]!.config.skillRefs).toEqual(["local-skill"]);
    expect(rewritten.nodes[0]!.config.unresolvedDependencies).toBeUndefined();
  });

  it("rewrites an allowed MCP tool reference to the local server id", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        allowedMcpToolRefs: [{ serverId: "source-server", toolName: "lookup" }],
      }),
    ]);
    const dependency = toolDependency("source-server", "Finance", "lookup", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      resolved: [{ dependency, localId: "local-server" }],
    });

    expect(rewritten.nodes[0]!.config.allowedMcpToolRefs).toEqual([
      { serverId: "local-server", toolName: "lookup" },
    ]);
  });

  it("rewrites the server a deterministic MCP node calls", () => {
    const snapshot = snapshotOf([
      node("node-1", "mcp", { instruction: "Fetch.", serverId: "source-server", toolName: "lookup" }),
    ]);
    const dependency = toolDependency("source-server", "Finance", "lookup", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      resolved: [{ dependency, localId: "local-server" }],
    });

    expect(rewritten.nodes[0]!.config.serverId).toBe("local-server");
    expect(rewritten.nodes[0]!.config.toolName).toBe("lookup");
  });
});

describe("rewriteSnapshot — unresolved dependencies", () => {
  it("clears the stale skill reference rather than leaving it dangling", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { skillRefs: ["source-skill", "other-skill"] }),
    ]);
    const missing = skillDependency("source-skill", "Procurement Policy", ["node-1"]);
    const kept = skillDependency("other-skill", "Records Policy", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, {
      ...emptyResolution,
      resolved: [{ dependency: kept, localId: "local-other" }],
      unresolved: [missing],
    });

    expect(rewritten.nodes[0]!.config.skillRefs).toEqual(["local-other"]);
  });

  it("flags the node with what did not resolve", () => {
    const snapshot = snapshotOf([node("node-1", "conversational", { skillRefs: ["source-skill"] })]);
    const missing = skillDependency("source-skill", "Procurement Policy", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, { ...emptyResolution, unresolved: [missing] });

    expect(rewritten.nodes[0]!.config.unresolvedDependencies).toEqual([missing]);
  });

  it("flags every node that referenced the missing dependency", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { skillRefs: ["source-skill"] }),
      node("node-2", "conversational", { skillRefs: ["source-skill"] }),
    ]);
    const missing = skillDependency("source-skill", "Procurement Policy", ["node-1", "node-2"]);

    const rewritten = rewriteSnapshot(snapshot, { ...emptyResolution, unresolved: [missing] });

    expect(rewritten.nodes[0]!.config.unresolvedDependencies).toHaveLength(1);
    expect(rewritten.nodes[1]!.config.unresolvedDependencies).toHaveLength(1);
  });

  it("does not flag a node that never referenced the missing dependency", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { skillRefs: ["source-skill"] }),
      node("node-2", "conversational", {}),
    ]);
    const missing = skillDependency("source-skill", "Procurement Policy", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, { ...emptyResolution, unresolved: [missing] });

    expect(rewritten.nodes[1]!.config.unresolvedDependencies).toBeUndefined();
  });

  it("drops an unresolved tool from a conversational allow-list so it is never offered", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        allowedMcpToolRefs: [{ serverId: "source-server", toolName: "lookup" }],
      }),
    ]);
    const missing = toolDependency("source-server", "Finance", "lookup", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, { ...emptyResolution, unresolved: [missing] });

    expect(rewritten.nodes[0]!.config.allowedMcpToolRefs).toEqual([]);
  });

  it("clears the server id on an MCP node whose server did not resolve", () => {
    const snapshot = snapshotOf([
      node("node-1", "mcp", { instruction: "Fetch.", serverId: "source-server", toolName: "lookup" }),
    ]);
    const missing = toolDependency("source-server", "Finance", "lookup", ["node-1"]);

    const rewritten = rewriteSnapshot(snapshot, { ...emptyResolution, unresolved: [missing] });

    expect(rewritten.nodes[0]!.config.serverId).toBeNull();
    expect(rewritten.nodes[0]!.config.unresolvedDependencies).toEqual([missing]);
  });
});

describe("rewriteSnapshot — purity", () => {
  it("does not mutate the snapshot it is given", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        skillRefs: ["source-skill"],
        documentTemplatePath: "source/templates/order.docx",
      }),
    ]);
    const dependency = skillDependency("source-skill", "Procurement Policy", ["node-1"]);

    rewriteSnapshot(snapshot, {
      resolved: [{ dependency, localId: "local-skill" }],
      unresolved: [],
      assetKeys: { "source/templates/order.docx": "new-key" },
    });

    expect(snapshot.nodes[0]!.config.skillRefs).toEqual(["source-skill"]);
    expect(snapshot.nodes[0]!.config.documentTemplatePath).toBe("source/templates/order.docx");
  });

  it("carries an unrecognised node type and its config through untouched", () => {
    const snapshot = snapshotOf([
      node("node-1", "scheduled", { somethingNewNobodyHasWrittenYet: { nested: true } }),
    ]);

    const rewritten = rewriteSnapshot(snapshot, emptyResolution);

    expect(rewritten.nodes[0]!.config.somethingNewNobodyHasWrittenYet).toEqual({ nested: true });
  });
});

describe("remapNodeReferences", () => {
  it("replaces every node id and leaves none of the originals behind", () => {
    const snapshot = snapshotOf([node("old-1", "conversational", {}), node("old-2", "conversational", {})]);

    const result = remapNodeReferences(snapshot, { "old-1": "new-1", "old-2": "new-2" });

    expect(result.error).toBeUndefined();
    expect(result.data!.nodes.map((entry) => entry.id)).toEqual(["new-1", "new-2"]);
  });

  it("rewrites both ends of every edge", () => {
    const snapshot = snapshotOf(
      [node("old-1", "conversational", {}), node("old-2", "conversational", {})],
      [{ id: "edge-1", fromNodeId: "old-1", toNodeId: "old-2" }],
    );

    const result = remapNodeReferences(snapshot, { "old-1": "new-1", "old-2": "new-2" });

    expect(result.data!.edges[0]!.fromNodeId).toBe("new-1");
    expect(result.data!.edges[0]!.toNodeId).toBe("new-2");
  });

  it("fails rather than orphaning an edge that points at an unmapped node", () => {
    const snapshot = snapshotOf(
      [node("old-1", "conversational", {})],
      [{ id: "edge-1", fromNodeId: "old-1", toNodeId: "ghost" }],
    );

    const result = remapNodeReferences(snapshot, { "old-1": "new-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("ghost");
  });

  it("remaps the node an approval step returns a change request to", () => {
    const snapshot = snapshotOf([
      node("old-1", "conversational", {}),
      node("old-2", "approval", {
        approverSource: "first_level_supervisor",
        changesRequestedTarget: { kind: "step", nodeId: "old-1" },
      }),
    ]);

    const result = remapNodeReferences(snapshot, { "old-1": "new-1", "old-2": "new-2" });

    expect(result.data!.nodes[1]!.config.changesRequestedTarget).toEqual({
      kind: "step",
      nodeId: "new-1",
    });
  });

  it("remaps the node an approval step asks the approver to sign off", () => {
    const snapshot = snapshotOf([
      node("old-1", "conversational", {}),
      node("old-2", "approval", {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: "old-1" },
      }),
    ]);

    const result = remapNodeReferences(snapshot, { "old-1": "new-1", "old-2": "new-2" });

    expect(result.data!.nodes[1]!.config.approvalSubject).toEqual({ kind: "step", nodeId: "new-1" });
  });

  it("leaves a nearest-editable target and a null subject alone", () => {
    const snapshot = snapshotOf([
      node("old-1", "approval", {
        approverSource: "first_level_supervisor",
        changesRequestedTarget: { kind: "nearest_editable" },
        approvalSubject: { kind: "step", nodeId: null },
      }),
    ]);

    const result = remapNodeReferences(snapshot, { "old-1": "new-1" });

    expect(result.data!.nodes[0]!.config.changesRequestedTarget).toEqual({ kind: "nearest_editable" });
    expect(result.data!.nodes[0]!.config.approvalSubject).toEqual({ kind: "step", nodeId: null });
  });

  it("fails when an approval step points at a node that is not in the map", () => {
    const snapshot = snapshotOf([
      node("old-1", "approval", {
        approverSource: "first_level_supervisor",
        changesRequestedTarget: { kind: "step", nodeId: "ghost" },
      }),
    ]);

    const result = remapNodeReferences(snapshot, { "old-1": "new-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("ghost");
  });

  it("does not mutate the snapshot it is given", () => {
    const snapshot = snapshotOf(
      [node("old-1", "conversational", {})],
      [{ id: "edge-1", fromNodeId: "old-1", toNodeId: "old-1" }],
    );

    remapNodeReferences(snapshot, { "old-1": "new-1" });

    expect(snapshot.nodes[0]!.id).toBe("old-1");
    expect(snapshot.edges[0]!.fromNodeId).toBe("old-1");
  });
});
