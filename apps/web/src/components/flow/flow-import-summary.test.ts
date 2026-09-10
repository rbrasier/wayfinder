import type { FlowExportDependency, FlowImportInspection } from "@wayfinder/domain";
import { describe, expect, it } from "vitest";
import { describeDependency, formatAssetSize, summariseInspection } from "./flow-import-summary";

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

const inspectionOf = (overrides: Partial<FlowImportInspection> = {}): FlowImportInspection => ({
  manifest: {
    formatVersion: 1,
    exportedAt: "2026-08-17T09:00:00.000Z",
    exportedFrom: { appVersion: "0.29.0" },
    snapshot: {
      flow: {
        name: "Procurement Approval",
        description: "Runs a purchase past the delegate.",
        icon: null,
        expertRole: null,
        contextDocs: [],
      },
      nodes: [
        { id: "node-1", type: "conversational", name: "Gather", colour: null, positionX: 0, positionY: 0, config: {} },
        { id: "node-2", type: "approval", name: "Approve", colour: null, positionX: 0, positionY: 0, config: {} },
      ],
      edges: [],
    },
    dependencies: [],
    assets: [],
  },
  resolved: [],
  unresolved: [],
  assetCount: 0,
  warnings: [],
  ...overrides,
});

describe("formatAssetSize", () => {
  it.each([
    [512, "512 B"],
    [2048, "2 KB"],
    [1024 * 1024 * 3.5, "3.5 MB"],
  ])("formats %i bytes as %s", (bytes, expected) => {
    expect(formatAssetSize(bytes)).toBe(expected);
  });
});

describe("describeDependency", () => {
  it("names a skill", () => {
    expect(describeDependency(skill)).toBe("Skill: Procurement Policy");
  });

  it("names an MCP tool by both its tool and its server", () => {
    expect(describeDependency(tool)).toBe("MCP tool: lookup_supplier on Finance");
  });
});

describe("summariseInspection", () => {
  it("carries the flow's identity and shape through", () => {
    const summary = summariseInspection(inspectionOf());

    expect(summary.flowName).toBe("Procurement Approval");
    expect(summary.description).toBe("Runs a purchase past the delegate.");
    expect(summary.nodeCount).toBe(2);
    expect(summary.exportedFrom).toBe("0.29.0");
  });

  it("lists each bundled file with a human-readable size", () => {
    const inspection = inspectionOf({ assetCount: 1 });
    inspection.manifest.assets = [
      {
        id: "asset-1",
        kind: "template",
        path: "source/templates/order.docx",
        filename: "order.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 2048,
        sha256: "a".repeat(64),
      },
    ];

    const summary = summariseInspection(inspection);

    expect(summary.files).toEqual([{ id: "asset-1", filename: "order.docx", size: "2 KB" }]);
    expect(summary.assetCount).toBe(1);
  });

  it("separates what was found here from what is missing", () => {
    const summary = summariseInspection(
      inspectionOf({ resolved: [{ dependency: skill, localId: "local-skill" }], unresolved: [tool] }),
    );

    expect(summary.found.map((entry) => entry.label)).toEqual(["Skill: Procurement Policy"]);
    expect(summary.missing.map((entry) => entry.label)).toEqual([
      "MCP tool: lookup_supplier on Finance",
    ]);
  });

  it("gives every row a distinct key, including two tools on one server", () => {
    const otherTool: FlowExportDependency = { ...tool, toolName: "create_order" };

    const summary = summariseInspection(inspectionOf({ unresolved: [tool, otherTool] }));

    expect(new Set(summary.missing.map((entry) => entry.key)).size).toBe(2);
  });

  it("flags that publish will be blocked when something is missing", () => {
    expect(summariseInspection(inspectionOf({ unresolved: [skill] })).publishBlocked).toBe(true);
  });

  it("does not flag publish when everything resolves", () => {
    const summary = summariseInspection(
      inspectionOf({ resolved: [{ dependency: skill, localId: "local-skill" }] }),
    );

    expect(summary.publishBlocked).toBe(false);
  });

  it("reports a flow that needs nothing from this deployment", () => {
    expect(summariseInspection(inspectionOf()).needsNothing).toBe(true);
  });

  it("passes ambiguity warnings through to the person deciding", () => {
    const warning = '2 skills here are named "Procurement Policy".';

    expect(summariseInspection(inspectionOf({ warnings: [warning] })).warnings).toEqual([warning]);
  });
});
