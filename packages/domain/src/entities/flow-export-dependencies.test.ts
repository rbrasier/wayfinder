import { describe, expect, it } from "vitest";
import { collectDependencies } from "./flow-export-dependencies";
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
  positionX: 0,
  positionY: 0,
  config,
});

const snapshotOf = (nodes: FlowSnapshotNode[]): FlowSnapshot => ({
  kind: "guided",
  flow: { name: "Flow", description: null, icon: null, expertRole: null, contextDocs: [] },
  nodes,
  edges: [],
});

describe("collectDependencies", () => {
  it("returns nothing for a flow with no external references", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { aiInstruction: "Ask.", doneWhen: "Answered." }),
    ]);

    expect(collectDependencies(snapshot)).toEqual([]);
  });

  it("collapses one skill used on several nodes into a single dependency listing every node", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { skillRefs: ["skill-a"] }),
      node("node-2", "conversational", { skillRefs: ["skill-a"] }),
    ]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toEqual({ kind: "skill", localId: "skill-a", nodeIds: ["node-1", "node-2"] });
  });

  it("keeps distinct skills apart and preserves author order", () => {
    const snapshot = snapshotOf([node("node-1", "conversational", { skillRefs: ["skill-b", "skill-a"] })]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies.map((dependency) => dependency.localId)).toEqual(["skill-b", "skill-a"]);
  });

  it("lists a node once even when it references the same skill twice", () => {
    const snapshot = snapshotOf([node("node-1", "conversational", { skillRefs: ["skill-a", "skill-a"] })]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]!.nodeIds).toEqual(["node-1"]);
  });

  it("turns an allowed MCP tool reference into a server-and-tool dependency", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        allowedMcpToolRefs: [{ serverId: "server-1", toolName: "lookup_supplier" }],
      }),
    ]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies).toEqual([
      { kind: "mcp_tool", localId: "server-1", toolName: "lookup_supplier", nodeIds: ["node-1"] },
    ]);
  });

  it("treats two tools on one server as two dependencies", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        allowedMcpToolRefs: [
          { serverId: "server-1", toolName: "lookup_supplier" },
          { serverId: "server-1", toolName: "create_order" },
        ],
      }),
    ]);

    expect(collectDependencies(snapshot)).toHaveLength(2);
  });

  it("collects the tool a deterministic MCP node calls, not just conversational allow-lists", () => {
    const snapshot = snapshotOf([
      node("node-1", "mcp", {
        instruction: "Fetch the supplier record.",
        serverId: "server-1",
        toolName: "lookup_supplier",
      }),
    ]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies).toEqual([
      { kind: "mcp_tool", localId: "server-1", toolName: "lookup_supplier", nodeIds: ["node-1"] },
    ]);
  });

  it("merges an MCP node and a conversational allow-list that name the same tool", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        allowedMcpToolRefs: [{ serverId: "server-1", toolName: "lookup_supplier" }],
      }),
      node("node-2", "mcp", { serverId: "server-1", toolName: "lookup_supplier" }),
    ]);

    const dependencies = collectDependencies(snapshot);

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]!.nodeIds).toEqual(["node-1", "node-2"]);
  });

  it("contributes nothing for an approval node — no user id is ever baked into one", () => {
    const snapshot = snapshotOf([
      node("node-1", "approval", {
        approverSource: "first_level_supervisor",
        instructions: "Confirm the spend.",
      }),
    ]);

    expect(collectDependencies(snapshot)).toEqual([]);
  });

  it("contributes nothing for an inline skill, which travels inside the snapshot", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", {
        inlineSkill: { name: "One-off", description: null, body: "text", allowedTools: [], frontmatter: {} },
      }),
    ]);

    expect(collectDependencies(snapshot)).toEqual([]);
  });

  it("ignores malformed config rather than throwing on it", () => {
    const snapshot = snapshotOf([
      node("node-1", "conversational", { skillRefs: "not-an-array" }),
      node("node-2", "conversational", { allowedMcpToolRefs: [{ serverId: 42 }] }),
      node("node-3", "mcp", { serverId: "server-1" }),
    ]);

    expect(collectDependencies(snapshot)).toEqual([]);
  });

  it("reads an extraction snapshot with no nodes without failing", () => {
    const snapshot: FlowSnapshot = {
      kind: "extraction",
      flow: { name: "Extract", description: null, icon: null, expertRole: null, contextDocs: [] },
      nodes: [],
      edges: [],
    };

    expect(collectDependencies(snapshot)).toEqual([]);
  });
});
