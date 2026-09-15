import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { domainError, err, ok } from "@wayfinder/domain";
import type {
  Flow,
  FlowArchiveAsset,
  FlowArchiveContents,
  FlowArchiveLimits,
  FlowContextDoc,
  FlowEdge,
  FlowExportManifest,
  FlowNode,
  FlowNodeUpdate,
  FlowPermissionRole,
  FlowUpdate,
  IAuditLogger,
  IFlowArchiveReader,
  IFlowArchiveWriter,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IMcpServerRepository,
  IObjectStorage,
  ISkillRepository,
  McpServer,
  NewAuditLog,
  NewFlow,
  NewFlowEdge,
  NewFlowNode,
  Result,
  Skill,
} from "@wayfinder/domain";
import { FLOW_ARCHIVE_LIMITS, FLOW_EXPORT_FORMAT_VERSION } from "@wayfinder/domain";
import { DuplicateFlow } from "./duplicate-flow";
import { ExportFlow } from "./export-flow";
import { ImportFlow } from "./import-flow";
import { InspectFlowImport } from "./inspect-flow-import";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const contextDoc = (overrides: Partial<FlowContextDoc> = {}): FlowContextDoc => ({
  id: "doc-1",
  filename: "policy.pdf",
  mimeType: "application/pdf",
  sizeBytes: 12,
  storagePath: "source/docs/policy.pdf",
  extractedText: "policy text",
  extractionStatus: "complete",
  ...overrides,
});

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Approval",
  description: "Runs a purchase past the delegate.",
  icon: null,
  expertRole: null,
  ownerUserId: "owner-1",
  flowType: "guided",
  status: "published",
  visibility: { kind: "private" },
  permissions: [{ userId: "owner-1", role: "owner" }],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Gather requirement",
  colour: null,
  positionX: 10,
  positionY: 20,
  config: { aiInstruction: "Ask.", doneWhen: "Answered.", outputType: "unstructured" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

class FakeFlowRepository implements IFlowRepository {
  flows = new Map<string, Flow>();
  private nextId = 100;

  async create(input: NewFlow): Promise<Result<Flow>> {
    const flow = makeFlow({
      id: `flow-${this.nextId++}`,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      expertRole: input.expertRole ?? null,
      ownerUserId: input.ownerUserId,
      flowType: input.flowType ?? "guided",
      status: "draft",
      permissions: [{ userId: input.ownerUserId, role: "owner" }],
      contextDocs: [],
    });
    this.flows.set(flow.id, flow);
    return ok(flow);
  }

  async findById(id: string): Promise<Result<Flow | null>> {
    return ok(this.flows.get(id) ?? null);
  }

  async list(): Promise<Result<Flow[]>> {
    return ok([...this.flows.values()]);
  }

  async listForUser(): Promise<Result<Flow[]>> {
    return ok([...this.flows.values()]);
  }

  async listExtraction(): Promise<Result<Flow[]>> {
    return ok([]);
  }

  async listExtractionForUser(): Promise<Result<Flow[]>> {
    return ok([]);
  }

  async update(id: string, patch: FlowUpdate): Promise<Result<Flow>> {
    const flow = this.flows.get(id);
    if (!flow) return err(domainError("NOT_FOUND", "Flow not found."));
    const updated = { ...flow, ...patch };
    this.flows.set(id, updated);
    return ok(updated);
  }

  async softDelete(id: string): Promise<Result<Flow>> {
    const flow = this.flows.get(id)!;
    return ok(flow);
  }

  async addContextDoc(flowId: string, doc: FlowContextDoc): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId);
    if (!flow) return err(domainError("NOT_FOUND", "Flow not found."));
    const updated = { ...flow, contextDocs: [...flow.contextDocs, doc] };
    this.flows.set(flowId, updated);
    return ok(updated);
  }

  async removeContextDoc(flowId: string, docId: string): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId)!;
    const updated = { ...flow, contextDocs: flow.contextDocs.filter((doc) => doc.id !== docId) };
    this.flows.set(flowId, updated);
    return ok(updated);
  }

  async setPermission(flowId: string, userId: string, role: FlowPermissionRole): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId)!;
    const updated = { ...flow, permissions: [...flow.permissions, { userId, role }] };
    this.flows.set(flowId, updated);
    return ok(updated);
  }
}

class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes = new Map<string, FlowNode>();
  private nextId = 100;

  async create(input: NewFlowNode): Promise<Result<FlowNode>> {
    const node = makeNode({
      id: `node-${this.nextId++}`,
      flowId: input.flowId,
      type: input.type,
      name: input.name,
      colour: input.colour ?? null,
      positionX: input.positionX,
      positionY: input.positionY,
      config: input.config,
    });
    this.nodes.set(node.id, node);
    return ok(node);
  }

  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.nodes.get(id) ?? null);
  }

  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()].filter((node) => node.flowId === flowId));
  }

  async update(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>> {
    const node = this.nodes.get(id);
    if (!node) return err(domainError("NOT_FOUND", "Node not found."));
    const updated = { ...node, ...patch };
    this.nodes.set(id, updated);
    return ok(updated);
  }

  async updatePosition(id: string): Promise<Result<FlowNode>> {
    return ok(this.nodes.get(id)!);
  }

  async delete(id: string): Promise<Result<true>> {
    this.nodes.delete(id);
    return ok(true);
  }
}

class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges = new Map<string, FlowEdge>();
  private nextId = 100;

  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    const edge: FlowEdge = {
      id: `edge-${this.nextId++}`,
      flowId: input.flowId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      config: input.config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.edges.set(edge.id, edge);
    return ok(edge);
  }

  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((edge) => edge.flowId === flowId));
  }

  async findById(id: string): Promise<Result<FlowEdge | null>> {
    return ok(this.edges.get(id) ?? null);
  }

  async updateConfig(id: string): Promise<Result<FlowEdge>> {
    return ok(this.edges.get(id)!);
  }

  async delete(id: string): Promise<Result<true>> {
    this.edges.delete(id);
    return ok(true);
  }
}

class FakeObjectStorage implements IObjectStorage {
  objects = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<Result<{ key: string }>> {
    this.objects.set(key, data);
    return ok({ key });
  }

  async get(key: string): Promise<Result<Buffer>> {
    const bytes = this.objects.get(key);
    if (!bytes) return err(domainError("NOT_FOUND", `No object at ${key}.`));
    return ok(bytes);
  }

  async delete(key: string): Promise<Result<void>> {
    this.objects.delete(key);
    return ok(undefined);
  }

  async exists(key: string): Promise<Result<boolean>> {
    return ok(this.objects.has(key));
  }

  async initialise(): Promise<void> {}
}

class FakeSkillRepository implements ISkillRepository {
  skills: Skill[] = [];

  async create(): Promise<Result<Skill>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }

  async update(): Promise<Result<Skill>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }

  async findById(id: string): Promise<Result<Skill | null>> {
    return ok(this.skills.find((skill) => skill.id === id) ?? null);
  }

  async listActiveByIds(ids: string[]): Promise<Result<Skill[]>> {
    return ok(this.skills.filter((skill) => ids.includes(skill.id)));
  }

  async list(): Promise<Result<Skill[]>> {
    return ok(this.skills);
  }

  async setStatus(): Promise<Result<Skill>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }
}

class FakeMcpServerRepository implements IMcpServerRepository {
  servers: McpServer[] = [];

  async create(): Promise<Result<McpServer>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }

  async update(): Promise<Result<McpServer>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }

  async findById(id: string): Promise<Result<McpServer | null>> {
    return ok(this.servers.find((server) => server.id === id) ?? null);
  }

  async list(): Promise<Result<McpServer[]>> {
    return ok(this.servers);
  }

  async setStatus(): Promise<Result<McpServer>> {
    return err(domainError("VALIDATION_FAILED", "not used"));
  }

  async delete(): Promise<Result<void>> {
    return ok(undefined);
  }
}

class FakeAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];

  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true);
  }
}

// Round-trips through a plain in-memory representation rather than a real zip:
// the zip itself is the adapter's business and is tested there.
class FakeArchive implements IFlowArchiveWriter, IFlowArchiveReader {
  written: { manifest: FlowExportManifest; assets: FlowArchiveAsset[] }[] = [];
  contents: FlowArchiveContents | null = null;
  readError: string | null = null;

  async write(manifest: FlowExportManifest, assets: FlowArchiveAsset[]): Promise<Result<Buffer>> {
    this.written.push({ manifest, assets });
    return ok(Buffer.from(JSON.stringify({ manifest, assetCount: assets.length })));
  }

  async read(_archive: Buffer, _limits: FlowArchiveLimits): Promise<Result<FlowArchiveContents>> {
    if (this.readError) return err(domainError("VALIDATION_FAILED", this.readError));
    if (!this.contents) return err(domainError("VALIDATION_FAILED", "no archive staged"));
    return ok(this.contents);
  }
}

const skill = (id: string, name: string): Skill => ({
  id,
  name,
  description: null,
  body: "skill body",
  allowedTools: [],
  frontmatter: {},
  version: 1,
  status: "active",
  createdByUserId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

const server = (id: string, label: string, communicatesExternally = false): McpServer => ({
  id,
  label,
  transport: "sse",
  url: "https://example.invalid/mcp",
  credentialRef: null,
  communicatesExternally,
  status: "active",
  createdByUserId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
});

let flows: FakeFlowRepository;
let nodes: FakeFlowNodeRepository;
let edges: FakeFlowEdgeRepository;
let storage: FakeObjectStorage;
let skills: FakeSkillRepository;
let servers: FakeMcpServerRepository;
let audit: FakeAuditLogger;
let archive: FakeArchive;

let exportFlow: ExportFlow;
let inspectImport: InspectFlowImport;
let importFlow: ImportFlow;
let duplicateFlow: DuplicateFlow;

let generatedKeys: number;
const generateKey = (): string => `flows/imported/asset-${generatedKeys++}`;

beforeEach(() => {
  flows = new FakeFlowRepository();
  nodes = new FakeFlowNodeRepository();
  edges = new FakeFlowEdgeRepository();
  storage = new FakeObjectStorage();
  skills = new FakeSkillRepository();
  servers = new FakeMcpServerRepository();
  audit = new FakeAuditLogger();
  archive = new FakeArchive();
  generatedKeys = 1;

  exportFlow = new ExportFlow(flows, nodes, edges, skills, servers, storage, archive, audit, "0.30.0", sha256);
  inspectImport = new InspectFlowImport(archive, skills, servers);
  importFlow = new ImportFlow(archive, skills, servers, storage, flows, nodes, edges, audit, generateKey);
  duplicateFlow = new DuplicateFlow(flows, nodes, edges, storage, generateKey);
});

const templateBytes = Buffer.from("template bytes");

const seedExportableFlow = (): void => {
  flows.flows.set(
    "flow-1",
    makeFlow({ contextDocs: [contextDoc({ storagePath: "source/docs/policy.pdf" })] }),
  );
  nodes.nodes.set(
    "node-1",
    makeNode({
      config: {
        aiInstruction: "Draft the order.",
        doneWhen: "Order drafted.",
        outputType: "document",
        documentTemplatePath: "source/templates/order.docx",
        documentTemplateFilename: "order.docx",
        skillRefs: ["skill-1"],
      },
    }),
  );
  storage.objects.set("source/templates/order.docx", templateBytes);
  storage.objects.set("source/docs/policy.pdf", Buffer.from("policy bytes"));
  skills.skills.push(skill("skill-1", "Procurement Policy"));
};

describe("ExportFlow", () => {
  beforeEach(seedExportableFlow);

  it("embeds the flow's snapshot in the manifest", async () => {
    const result = await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(result.error).toBeUndefined();
    const { manifest } = archive.written[0]!;
    expect(manifest.snapshot.flow.name).toBe("Procurement Approval");
    expect(manifest.snapshot.nodes[0]!.config.aiInstruction).toBe("Draft the order.");
  });

  it("bundles every referenced template and context document with a matching sha256", async () => {
    await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    const { manifest, assets } = archive.written[0]!;
    expect(manifest.assets).toHaveLength(2);

    const template = manifest.assets.find((asset) => asset.kind === "template")!;
    expect(template.sha256).toBe(sha256(templateBytes));
    expect(assets.find((entry) => entry.asset.id === template.id)!.bytes).toEqual(templateBytes);

    const doc = manifest.assets.find((asset) => asset.kind === "context_doc")!;
    expect(doc.sha256).toBe(sha256(Buffer.from("policy bytes")));
  });

  it("exports dependencies by name, with no local skill id in the manifest's name fields", async () => {
    await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    const { manifest } = archive.written[0]!;
    expect(manifest.dependencies).toEqual([
      { kind: "skill", sourceId: "skill-1", name: "Procurement Policy", nodeIds: ["node-1"] },
    ]);
  });

  it("carries no instance data of any kind, anywhere in the payload", async () => {
    await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    const payload = JSON.stringify(archive.written[0]!.manifest);
    for (const forbidden of [
      "sessionId",
      "sessions",
      "messageId",
      "messages",
      "stepOutput",
      "approvalRecord",
      "documentId",
      "ownerUserId",
      "deletedAt",
    ]) {
      expect(payload).not.toContain(forbidden);
    }
  });

  it("names the top-level manifest fields and nothing else", async () => {
    await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(Object.keys(archive.written[0]!.manifest).sort()).toEqual([
      "assets",
      "dependencies",
      "exportedAt",
      "exportedFrom",
      "formatVersion",
      "snapshot",
    ]);
  });

  it("lets an admin who does not own the flow export it", async () => {
    const result = await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "someone-else", isAdmin: true });

    expect(result.error).toBeUndefined();
  });

  it("refuses a user who neither owns the flow nor is an admin", async () => {
    const result = await exportFlow.execute({
      flowId: "flow-1",
      requestedByUserId: "someone-else",
      isAdmin: false,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(archive.written).toHaveLength(0);
  });

  it("returns NOT_FOUND for a flow that does not exist", async () => {
    const result = await exportFlow.execute({ flowId: "ghost", requestedByUserId: "owner-1", isAdmin: true });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("emits flow.exported to the audit log", async () => {
    await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.action).toBe("flow.exported");
    expect(audit.entries[0]!.actorId).toBe("owner-1");
    expect(audit.entries[0]!.resourceId).toBe("flow-1");
  });

  it("fails rather than exporting a flow whose template is missing from storage", async () => {
    storage.objects.delete("source/templates/order.docx");

    const result = await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(result.error).toBeDefined();
    expect(archive.written).toHaveLength(0);
  });

  it("offers a filename derived from the flow name", async () => {
    const result = await exportFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(result.data!.filename).toMatch(/^procurement-approval-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

const stagedManifest = (overrides: Partial<FlowExportManifest> = {}): FlowExportManifest => ({
  formatVersion: FLOW_EXPORT_FORMAT_VERSION,
  exportedAt: "2026-08-17T09:00:00.000Z",
  exportedFrom: { appVersion: "0.29.0" },
  snapshot: {
    flow: { name: "Procurement Approval", description: null, icon: null, expertRole: null, contextDocs: [] },
    nodes: [
      {
        id: "src-node-1",
        type: "conversational",
        name: "Gather",
        colour: null,
        positionX: 0,
        positionY: 0,
        config: { aiInstruction: "Ask.", doneWhen: "Answered.", skillRefs: ["src-skill-1"] },
      },
    ],
    edges: [],
  },
  dependencies: [
    { kind: "skill", sourceId: "src-skill-1", name: "Procurement Policy", nodeIds: ["src-node-1"] },
  ],
  assets: [],
  ...overrides,
});

const stage = (manifest: FlowExportManifest, assets: Map<string, Buffer> = new Map()): void => {
  archive.contents = { manifest, assets };
};

describe("InspectFlowImport", () => {
  it("reports a dependency that resolves here", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest());

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.error).toBeUndefined();
    expect(result.data!.resolved).toHaveLength(1);
    expect(result.data!.resolved[0]!.localId).toBe("local-skill");
    expect(result.data!.unresolved).toEqual([]);
  });

  it("reports a dependency that does not resolve here", async () => {
    stage(stagedManifest());

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.data!.unresolved).toHaveLength(1);
    expect(result.data!.resolved).toEqual([]);
  });

  it("writes no row and no object", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest(), new Map([["asset-1", templateBytes]]));

    await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(flows.flows.size).toBe(0);
    expect(nodes.nodes.size).toBe(0);
    expect(edges.edges.size).toBe(0);
    expect(storage.objects.size).toBe(0);
    expect(audit.entries).toHaveLength(0);
  });

  it("surfaces a refused formatVersion as a Result error, not an inspection", async () => {
    archive.readError = "This archive was written in flow export format 2, and this deployment reads up to 1.";

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.data).toBeUndefined();
  });

  it("warns when two local skills share the dependency's name, and leaves it unresolved", async () => {
    skills.skills.push(skill("skill-a", "Procurement Policy"), skill("skill-b", "Procurement Policy"));
    stage(stagedManifest());

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.data!.unresolved).toHaveLength(1);
    expect(result.data!.warnings[0]).toContain("Procurement Policy");
  });

  it("reports the asset count from the manifest", async () => {
    stage(
      stagedManifest({
        assets: [
          {
            id: "asset-1",
            kind: "template",
            path: "source/templates/order.docx",
            filename: "order.docx",
            mimeType: DOCX_MIME,
            sizeBytes: templateBytes.length,
            sha256: sha256(templateBytes),
          },
        ],
      }),
      new Map([["asset-1", templateBytes]]),
    );

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.data!.assetCount).toBe(1);
  });

  it("passes the configured ceilings to the reader", async () => {
    stage(stagedManifest());

    const result = await inspectImport.execute({ archive: Buffer.from("zip") });

    expect(result.error).toBeUndefined();
    expect(FLOW_ARCHIVE_LIMITS.maxAssetCount).toBe(100);
  });
});

describe("ImportFlow", () => {
  const manifestWithTemplate = (): FlowExportManifest =>
    stagedManifest({
      snapshot: {
        flow: { name: "Procurement Approval", description: null, icon: null, expertRole: null, contextDocs: [] },
        nodes: [
          {
            id: "src-node-1",
            type: "conversational",
            name: "Draft",
            colour: null,
            positionX: 0,
            positionY: 0,
            config: {
              aiInstruction: "Draft.",
              doneWhen: "Drafted.",
              documentTemplatePath: "source/templates/order.docx",
              skillRefs: ["src-skill-1"],
            },
          },
        ],
        edges: [],
      },
      assets: [
        {
          id: "asset-1",
          kind: "template",
          path: "source/templates/order.docx",
          filename: "order.docx",
          mimeType: DOCX_MIME,
          sizeBytes: templateBytes.length,
          sha256: sha256(templateBytes),
        },
      ],
    });

  it("always creates a new flow, owned by the importer and in draft", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest());

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    expect(result.error).toBeUndefined();
    const created = flows.flows.get(result.data!.flow.id)!;
    expect(created.ownerUserId).toBe("importer-1");
    expect(created.status).toBe("draft");
  });

  it("modifies no existing flow", async () => {
    flows.flows.set("flow-1", makeFlow());
    const before = { ...flows.flows.get("flow-1")! };
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest());

    await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    expect(flows.flows.get("flow-1")).toEqual(before);
  });

  it("stores assets under freshly generated keys, never a path from the archive", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(manifestWithTemplate(), new Map([["asset-1", templateBytes]]));

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    const storedKeys = [...storage.objects.keys()];
    expect(storedKeys).toEqual(["flows/imported/asset-1"]);
    expect(storedKeys).not.toContain("source/templates/order.docx");

    const created = [...nodes.nodes.values()].find((node) => node.flowId === result.data!.flow.id)!;
    expect(created.config.documentTemplatePath).toBe("flows/imported/asset-1");
  });

  it("regenerates node ids so no id from the archive survives", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest());

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    const created = [...nodes.nodes.values()].filter((node) => node.flowId === result.data!.flow.id);
    expect(created.map((node) => node.id)).not.toContain("src-node-1");
  });

  it("rewrites a resolved dependency to the local id", async () => {
    skills.skills.push(skill("local-skill", "Procurement Policy"));
    stage(stagedManifest());

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    const created = [...nodes.nodes.values()].find((node) => node.flowId === result.data!.flow.id)!;
    expect(created.config.skillRefs).toEqual(["local-skill"]);
  });

  it("imports anyway when a dependency does not resolve, flagging the node", async () => {
    stage(stagedManifest());

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    expect(result.error).toBeUndefined();
    expect(result.data!.unresolved).toHaveLength(1);

    const created = [...nodes.nodes.values()].find((node) => node.flowId === result.data!.flow.id)!;
    expect(created.config.skillRefs).toEqual([]);
    expect(created.config.unresolvedDependencies).toHaveLength(1);
  });

  it("rewrites both ends of every edge against the new node ids", async () => {
    stage(
      stagedManifest({
        snapshot: {
          flow: { name: "Two Steps", description: null, icon: null, expertRole: null, contextDocs: [] },
          nodes: [
            { id: "src-a", type: "conversational", name: "A", colour: null, positionX: 0, positionY: 0, config: {} },
            { id: "src-b", type: "conversational", name: "B", colour: null, positionX: 0, positionY: 0, config: {} },
          ],
          edges: [{ id: "src-edge", fromNodeId: "src-a", toNodeId: "src-b" }],
        },
        dependencies: [],
      }),
    );

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    const createdNodes = [...nodes.nodes.values()].filter((node) => node.flowId === result.data!.flow.id);
    const createdEdge = [...edges.edges.values()].find((edge) => edge.flowId === result.data!.flow.id)!;
    const ids = createdNodes.map((node) => node.id);

    expect(ids).toContain(createdEdge.fromNodeId);
    expect(ids).toContain(createdEdge.toNodeId);
    expect(createdEdge.fromNodeId).not.toBe("src-a");
  });

  it("carries the flow's context documents across under new keys", async () => {
    stage(
      stagedManifest({
        snapshot: {
          flow: {
            name: "With Docs",
            description: null,
            icon: null,
            expertRole: null,
            contextDocs: [contextDoc({ storagePath: "source/docs/policy.pdf" })],
          },
          nodes: [],
          edges: [],
        },
        dependencies: [],
        assets: [
          {
            id: "asset-doc",
            kind: "context_doc",
            path: "source/docs/policy.pdf",
            filename: "policy.pdf",
            mimeType: "application/pdf",
            sizeBytes: 5,
            sha256: sha256(Buffer.from("bytes")),
          },
        ],
      }),
      new Map([["asset-doc", Buffer.from("bytes")]]),
    );

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    const created = flows.flows.get(result.data!.flow.id)!;
    expect(created.contextDocs[0]!.storagePath).toBe("flows/imported/asset-1");
  });

  it("emits flow.imported to the audit log", async () => {
    stage(stagedManifest());

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    expect(audit.entries[0]!.action).toBe("flow.imported");
    expect(audit.entries[0]!.actorId).toBe("importer-1");
    expect(audit.entries[0]!.resourceId).toBe(result.data!.flow.id);
  });

  it("surfaces a reader failure without writing anything", async () => {
    archive.readError = "The uploaded archive is not a readable zip file.";

    const result = await importFlow.execute({ archive: Buffer.from("zip"), importedByUserId: "importer-1" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(flows.flows.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });
});

describe("DuplicateFlow", () => {
  beforeEach(seedExportableFlow);

  it("produces an independent draft copy with a suffixed name", async () => {
    const result = await duplicateFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(result.error).toBeUndefined();
    const copy = flows.flows.get(result.data!.id)!;
    expect(copy.id).not.toBe("flow-1");
    expect(copy.name).toBe("Procurement Approval (copy)");
    expect(copy.status).toBe("draft");
  });

  it("gives the copy fresh node ids", async () => {
    const result = await duplicateFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    const copied = [...nodes.nodes.values()].filter((node) => node.flowId === result.data!.id);
    expect(copied).toHaveLength(1);
    expect(copied[0]!.id).not.toBe("node-1");
  });

  it("gives the copy its own asset objects, so deleting the original's template leaves it intact", async () => {
    const result = await duplicateFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    const copied = [...nodes.nodes.values()].find((node) => node.flowId === result.data!.id)!;
    const copyKey = copied.config.documentTemplatePath as string;
    expect(copyKey).not.toBe("source/templates/order.docx");

    await storage.delete("source/templates/order.docx");

    expect(storage.objects.get(copyKey)).toEqual(templateBytes);
  });

  it("keeps the original untouched", async () => {
    const before = { ...flows.flows.get("flow-1")! };

    await duplicateFlow.execute({ flowId: "flow-1", requestedByUserId: "owner-1", isAdmin: false });

    expect(flows.flows.get("flow-1")).toEqual(before);
  });

  it("refuses a user who neither owns the flow nor is an admin", async () => {
    const result = await duplicateFlow.execute({
      flowId: "flow-1",
      requestedByUserId: "someone-else",
      isAdmin: false,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(flows.flows.size).toBe(1);
  });
});
