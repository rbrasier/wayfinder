import type { FlowExportDependency } from "@wayfinder/domain";
import { describe, expect, it } from "vitest";
import { unresolvedBadgeModel, unresolvedDependenciesOf } from "./unresolved-dependencies";

const skill: FlowExportDependency = {
  kind: "skill",
  sourceId: "src-skill",
  name: "Procurement Policy",
  nodeIds: ["node-1"],
};

const tool: FlowExportDependency = {
  kind: "mcp_tool",
  sourceId: "src-server",
  name: "Finance",
  toolName: "lookup_supplier",
  nodeIds: ["node-1"],
};

describe("unresolvedDependenciesOf", () => {
  it("reads the flag off a node config", () => {
    expect(unresolvedDependenciesOf({ unresolvedDependencies: [skill] })).toEqual([skill]);
  });

  it("treats a node with no flag as having nothing missing", () => {
    expect(unresolvedDependenciesOf({ aiInstruction: "Ask." })).toEqual([]);
  });

  it("ignores a flag that is not an array rather than throwing on it", () => {
    expect(unresolvedDependenciesOf({ unresolvedDependencies: "broken" })).toEqual([]);
  });

  it("drops malformed entries but keeps the good ones", () => {
    expect(unresolvedDependenciesOf({ unresolvedDependencies: [skill, null, { kind: "skill" }] })).toEqual([
      skill,
    ]);
  });
});

describe("unresolvedBadgeModel", () => {
  it("draws no badge for a node with nothing missing", () => {
    expect(unresolvedBadgeModel({ aiInstruction: "Ask." })).toBeNull();
  });

  it("counts a single missing reference in the singular", () => {
    expect(unresolvedBadgeModel({ unresolvedDependencies: [skill] })?.label).toBe(
      "1 missing reference",
    );
  });

  it("counts several in the plural", () => {
    expect(unresolvedBadgeModel({ unresolvedDependencies: [skill, tool] })?.label).toBe(
      "2 missing references",
    );
  });

  it("names what is missing, so the author need not open the step to find out", () => {
    expect(unresolvedBadgeModel({ unresolvedDependencies: [skill, tool] })?.title).toBe(
      'Missing: skill "Procurement Policy", MCP tool "lookup_supplier" on "Finance"',
    );
  });
});
