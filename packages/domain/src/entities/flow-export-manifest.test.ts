import { describe, expect, it } from "vitest";
import type { FlowSnapshot } from "./flow-version";
import {
  FLOW_EXPORT_FORMAT_VERSION,
  MIN_SUPPORTED_FORMAT_VERSION,
  type FlowExportManifest,
} from "./flow-export";
import { migrateManifest, validateManifest, type ManifestMigration } from "./flow-export-manifest";

const snapshot: FlowSnapshot = {
  kind: "guided",
  flow: {
    name: "Procurement Approval",
    description: "Runs a purchase past the delegate.",
    icon: null,
    expertRole: null,
    contextDocs: [],
  },
  nodes: [
    {
      id: "node-1",
      type: "conversational",
      name: "Gather requirement",
      colour: null,
      positionX: 0,
      positionY: 0,
      config: { aiInstruction: "Ask what is being bought.", doneWhen: "Item is named.", outputType: "unstructured" },
    },
  ],
  edges: [],
};

const validManifest = (): FlowExportManifest => ({
  formatVersion: FLOW_EXPORT_FORMAT_VERSION,
  exportedAt: "2026-08-17T09:00:00.000Z",
  exportedFrom: { appVersion: "0.30.0" },
  snapshot,
  dependencies: [{ kind: "skill", sourceId: "skill-a", name: "Procurement Policy", nodeIds: ["node-1"] }],
  assets: [
    {
      id: "asset-1",
      kind: "template",
      path: "flows/flow-1/templates/order.docx",
      filename: "order.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 2048,
      sha256: "a".repeat(64),
    },
  ],
});

describe("validateManifest", () => {
  it("accepts a well-formed manifest and returns it typed", () => {
    const result = validateManifest(validManifest());

    expect(result.error).toBeUndefined();
    expect(result.data!.snapshot.flow.name).toBe("Procurement Approval");
    expect(result.data!.assets).toHaveLength(1);
    expect(result.data!.dependencies[0]!.kind).toBe("skill");
  });

  it("accepts a manifest with no dependencies and no assets", () => {
    const manifest = { ...validManifest(), dependencies: [], assets: [] };

    const result = validateManifest(manifest);

    expect(result.error).toBeUndefined();
    expect(result.data!.dependencies).toEqual([]);
  });

  it("rejects a manifest that is not an object", () => {
    const result = validateManifest("not a manifest");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("object");
  });

  it("names the missing field when one is absent", () => {
    const manifest: Record<string, unknown> = { ...validManifest() };
    delete manifest.exportedAt;

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("exportedAt");
  });

  it("names the field and the expected type when one is mistyped", () => {
    const result = validateManifest({ ...validManifest(), exportedAt: 1234 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("exportedAt");
    expect(result.error?.message).toContain("string");
  });

  it("names an unexpected top-level field rather than ignoring it", () => {
    const result = validateManifest({ ...validManifest(), sneakyExtra: "payload" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("sneakyExtra");
  });

  it("refuses a formatVersion newer than this deployment supports, naming both versions", () => {
    const ahead = FLOW_EXPORT_FORMAT_VERSION + 1;

    const result = validateManifest({ ...validManifest(), formatVersion: ahead });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain(String(ahead));
    expect(result.error?.message).toContain(String(FLOW_EXPORT_FORMAT_VERSION));
  });

  it("refuses a formatVersion older than the supported floor", () => {
    const tooOld = MIN_SUPPORTED_FORMAT_VERSION - 1;

    const result = validateManifest({ ...validManifest(), formatVersion: tooOld });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain(String(tooOld));
  });

  it("rejects a non-integer formatVersion", () => {
    const result = validateManifest({ ...validManifest(), formatVersion: 1.5 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("formatVersion");
  });

  it("rejects a snapshot missing its nodes array", () => {
    const result = validateManifest({
      ...validManifest(),
      snapshot: { flow: snapshot.flow, edges: [] },
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("snapshot.nodes");
  });

  it("rejects an asset whose sha256 is not a 64-character hex digest", () => {
    const manifest = validManifest();
    manifest.assets[0]!.sha256 = "short";

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("sha256");
  });

  it("rejects an asset kind outside the known set", () => {
    const manifest = validManifest();
    (manifest.assets[0]! as { kind: string }).kind = "executable";

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("kind");
  });

  it("rejects a dependency kind outside the known set", () => {
    const manifest = validManifest();
    (manifest.dependencies[0]! as { kind: string }).kind = "kb_collection";

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("kind");
  });

  it("requires toolName on an mcp_tool dependency", () => {
    const manifest = validManifest();
    manifest.dependencies = [
      { kind: "mcp_tool", sourceId: "server-1", name: "Finance Server", nodeIds: ["node-1"] },
    ];

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("toolName");
  });

  it("rejects a negative asset size", () => {
    const manifest = validManifest();
    manifest.assets[0]!.sizeBytes = -1;

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("sizeBytes");
  });
});

describe("migrateManifest", () => {
  it("returns a current-version manifest unchanged", () => {
    const manifest = validManifest();

    const result = migrateManifest(manifest);

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(manifest);
  });

  it("walks every step from an older version up to the current one", () => {
    const appliedSteps: number[] = [];
    const migrations: ManifestMigration[] = [
      {
        fromVersion: 1,
        apply: (manifest) => {
          appliedSteps.push(1);
          return { ...manifest, formatVersion: 2 };
        },
      },
      {
        fromVersion: 2,
        apply: (manifest) => {
          appliedSteps.push(2);
          return { ...manifest, formatVersion: 3 };
        },
      },
    ];

    const result = migrateManifest({ ...validManifest(), formatVersion: 1 }, migrations, 3);

    expect(result.error).toBeUndefined();
    expect(appliedSteps).toEqual([1, 2]);
    expect(result.data!.formatVersion).toBe(3);
  });

  it("does not mutate the manifest it is given", () => {
    const manifest = { ...validManifest(), formatVersion: 1 };
    const migrations: ManifestMigration[] = [
      { fromVersion: 1, apply: (older) => ({ ...older, formatVersion: 2 }) },
    ];

    migrateManifest(manifest, migrations, 2);

    expect(manifest.formatVersion).toBe(1);
  });

  it("fails with an actionable message when a step in the chain is missing", () => {
    const migrations: ManifestMigration[] = [
      { fromVersion: 2, apply: (older) => ({ ...older, formatVersion: 3 }) },
    ];

    const result = migrateManifest({ ...validManifest(), formatVersion: 1 }, migrations, 3);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("1");
  });
});

describe("validateManifest — dependency join key", () => {
  it("requires the sourceId that links a named dependency back to the snapshot", () => {
    const manifest = validManifest();
    delete (manifest.dependencies[0]! as { sourceId?: string }).sourceId;

    const result = validateManifest(manifest);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("sourceId");
  });
});
