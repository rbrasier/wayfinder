import { describe, expect, it } from "vitest";
import type { FlowExportDependency } from "./flow-export";
import { resolveFlowDependencies, type DependencyCandidates } from "./flow-import-resolve";

const skillDependency = (name: string): FlowExportDependency => ({
  kind: "skill",
  sourceId: "source-skill",
  name,
  nodeIds: ["node-1"],
});

const toolDependency = (name: string, toolName = "lookup"): FlowExportDependency => ({
  kind: "mcp_tool",
  sourceId: "source-server",
  name,
  toolName,
  nodeIds: ["node-1"],
});

const candidates = (overrides: Partial<DependencyCandidates> = {}): DependencyCandidates => ({
  skills: [],
  servers: [],
  ...overrides,
});

describe("resolveFlowDependencies — skills", () => {
  it("resolves a skill matched by name to its local id", () => {
    const outcome = resolveFlowDependencies(
      [skillDependency("Procurement Policy")],
      candidates({ skills: [{ id: "local-skill", name: "Procurement Policy" }] }),
    );

    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.resolved[0]!.localId).toBe("local-skill");
    expect(outcome.unresolved).toEqual([]);
  });

  it("leaves a skill unresolved when nothing here has that name", () => {
    const dependency = skillDependency("Procurement Policy");

    const outcome = resolveFlowDependencies([dependency], candidates({ skills: [{ id: "x", name: "Other" }] }));

    expect(outcome.resolved).toEqual([]);
    expect(outcome.unresolved).toEqual([dependency]);
  });

  it("matches on the exact name, not a case-insensitive or trimmed one", () => {
    const outcome = resolveFlowDependencies(
      [skillDependency("Procurement Policy")],
      candidates({ skills: [{ id: "local-skill", name: "procurement policy" }] }),
    );

    expect(outcome.unresolved).toHaveLength(1);
  });

  it("refuses to guess when two local skills share the name, and says which", () => {
    const dependency = skillDependency("Procurement Policy");

    const outcome = resolveFlowDependencies(
      [dependency],
      candidates({
        skills: [
          { id: "skill-a", name: "Procurement Policy" },
          { id: "skill-b", name: "Procurement Policy" },
        ],
      }),
    );

    expect(outcome.resolved).toEqual([]);
    expect(outcome.unresolved).toEqual([dependency]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toContain("Procurement Policy");
    expect(outcome.warnings[0]).toContain("2");
  });
});

describe("resolveFlowDependencies — MCP tools", () => {
  it("resolves an MCP tool by its server label", () => {
    const outcome = resolveFlowDependencies(
      [toolDependency("Finance")],
      candidates({ servers: [{ id: "local-server", label: "Finance", dataClassification: "internal" }] }),
    );

    expect(outcome.resolved[0]!.localId).toBe("local-server");
  });

  it("leaves an MCP tool unresolved when no server carries that label", () => {
    const dependency = toolDependency("Finance");

    const outcome = resolveFlowDependencies([dependency], candidates());

    expect(outcome.unresolved).toEqual([dependency]);
  });

  it("refuses to guess when two servers share a label", () => {
    const outcome = resolveFlowDependencies(
      [toolDependency("Finance")],
      candidates({
        servers: [
          { id: "server-a", label: "Finance", dataClassification: "internal" },
          { id: "server-b", label: "Finance", dataClassification: "internal" },
        ],
      }),
    );

    expect(outcome.resolved).toEqual([]);
    expect(outcome.warnings[0]).toContain("Finance");
  });

  it("resolves to a public-data reader", () => {
    const dependency = toolDependency("Legislation");

    const outcome = resolveFlowDependencies(
      [dependency],
      candidates({ servers: [{ id: "local-server", label: "Legislation", dataClassification: "public-read" }] }),
    );

    expect(outcome.resolved).toEqual([{ dependency, localId: "local-server" }]);
  });

  it("does not resolve to a server that sends records outside Wayfinder, and warns why", () => {
    const dependency = toolDependency("Finance");

    const outcome = resolveFlowDependencies(
      [dependency],
      candidates({ servers: [{ id: "local-server", label: "Finance", dataClassification: "external-write" }] }),
    );

    expect(outcome.resolved).toEqual([]);
    expect(outcome.unresolved).toEqual([dependency]);
    expect(outcome.warnings[0]).toContain("outside Wayfinder");
  });
});

describe("resolveFlowDependencies — shape", () => {
  it("returns empty results for an archive with no dependencies", () => {
    const outcome = resolveFlowDependencies([], candidates());

    expect(outcome).toEqual({ resolved: [], unresolved: [], warnings: [] });
  });

  it("reports each dependency exactly once across resolved and unresolved", () => {
    const outcome = resolveFlowDependencies(
      [skillDependency("Known"), toolDependency("Unknown")],
      candidates({ skills: [{ id: "local-skill", name: "Known" }] }),
    );

    expect(outcome.resolved).toHaveLength(1);
    expect(outcome.unresolved).toHaveLength(1);
  });
});
