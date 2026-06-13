import { describe, it, expect, beforeEach } from "vitest";
import { buildFlowSnapshot, domainError, err, ok } from "@rbrasier/domain";
import type {
  CreatePublishedVersion,
  Flow,
  FlowEdge,
  FlowNode,
  FlowVersion,
  FlowVersionSummary,
  IAuditLogger,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IFlowVersionRepository,
  NewAuditLog,
  NewFlow,
  NewFlowEdge,
  NewFlowNode,
  RestoreVersion,
  Result,
  UpsertDraftVersion,
} from "@rbrasier/domain";
import { PublishFlowVersion } from "./publish-flow-version";
import { ListFlowVersions } from "./list-flow-versions";
import { GetFlowVersion } from "./get-flow-version";
import { RestoreFlowVersion } from "./restore-flow-version";
import { SyncFlowDraft } from "./sync-flow-draft";

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Procurement Intake",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [{ userId: "user-1", role: "owner" }],
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
  name: "Step 1",
  colour: "#6366f1",
  positionX: 0,
  positionY: 0,
  config: { aiInstruction: "Help", doneWhen: "Done", outputType: "conversation_only" },
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

const makeEdge = (overrides: Partial<FlowEdge> = {}): FlowEdge => ({
  id: "edge-1",
  flowId: "flow-1",
  fromNodeId: "node-1",
  toNodeId: "node-2",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

// ── Fakes ──────────────────────────────────────────────────────────────────

class FakeFlowRepository implements IFlowRepository {
  flows: Map<string, Flow> = new Map();
  async create(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async findById(id: string): Promise<Result<Flow | null>> { return ok(this.flows.get(id) ?? null); }
  async list(): Promise<Result<Flow[]>> { return ok([...this.flows.values()]); }
  async listForUser(): Promise<Result<Flow[]>> { return ok([]); }
  async update(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async softDelete(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async addContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async removeContextDoc(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async setPermission(): Promise<Result<Flow>> { return err(domainError("INFRA_FAILURE", "not used")); }
}

class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes: Map<string, FlowNode> = new Map();
  async create(input: NewFlowNode): Promise<Result<FlowNode>> {
    const node = { ...makeNode(), ...input, id: `node-${this.nodes.size + 1}` } as FlowNode;
    this.nodes.set(node.id, node);
    return ok(node);
  }
  async findById(id: string): Promise<Result<FlowNode | null>> { return ok(this.nodes.get(id) ?? null); }
  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()].filter((n) => n.flowId === flowId));
  }
  async update(): Promise<Result<FlowNode>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async updatePosition(): Promise<Result<FlowNode>> { return err(domainError("INFRA_FAILURE", "not used")); }
  async delete(): Promise<Result<true>> { return ok(true as const); }
}

class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges: Map<string, FlowEdge> = new Map();
  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    const edge = { ...makeEdge(), ...input, id: `edge-${this.edges.size + 1}` } as FlowEdge;
    this.edges.set(edge.id, edge);
    return ok(edge);
  }
  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((e) => e.flowId === flowId));
  }
  async delete(): Promise<Result<true>> { return ok(true as const); }
}

// Models the draft→published lifecycle and monotonic numbering in memory so the
// use-cases are exercised against realistic repository behaviour.
class FakeFlowVersionRepository implements IFlowVersionRepository {
  versions: FlowVersion[] = [];
  private seq = 0;

  private nextNumber(flowId: string): number {
    const published = this.versions.filter((v) => v.flowId === flowId && v.versionNumber !== null);
    return published.reduce((max, v) => Math.max(max, v.versionNumber ?? 0), 0) + 1;
  }

  async createPublished(input: CreatePublishedVersion): Promise<Result<FlowVersion>> {
    const number = this.nextNumber(input.flowId);
    const draft = this.versions.find((v) => v.flowId === input.flowId && v.status === "draft");
    const now = new Date();
    if (draft) {
      draft.status = "published";
      draft.versionNumber = number;
      draft.snapshot = input.snapshot;
      draft.changeSummary = input.changeSummary ?? null;
      draft.publishedByUserId = input.publishedByUserId;
      draft.publishedAt = now;
      return ok(draft);
    }
    const version: FlowVersion = {
      id: `version-${++this.seq}`,
      flowId: input.flowId,
      versionNumber: number,
      status: "published",
      snapshot: input.snapshot,
      changeSummary: input.changeSummary ?? null,
      publishedByUserId: input.publishedByUserId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.versions.push(version);
    return ok(version);
  }

  async upsertDraft(input: UpsertDraftVersion): Promise<Result<FlowVersion>> {
    const existing = this.versions.find((v) => v.flowId === input.flowId && v.status === "draft");
    if (existing) {
      existing.snapshot = input.snapshot;
      return ok(existing);
    }
    const version: FlowVersion = {
      id: `version-${++this.seq}`,
      flowId: input.flowId,
      versionNumber: null,
      status: "draft",
      snapshot: input.snapshot,
      changeSummary: input.changeSummary ?? null,
      publishedByUserId: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.versions.push(version);
    return ok(version);
  }

  async restore(input: RestoreVersion): Promise<Result<FlowVersion>> {
    const number = this.nextNumber(input.flowId);
    const now = new Date();
    const version: FlowVersion = {
      id: `version-${++this.seq}`,
      flowId: input.flowId,
      versionNumber: number,
      status: "published",
      snapshot: input.snapshot,
      changeSummary: input.changeSummary ?? `Restored from version ${input.sourceVersionNumber}`,
      publishedByUserId: input.publishedByUserId,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.versions.push(version);
    return ok(version);
  }

  async listForFlow(flowId: string): Promise<Result<FlowVersionSummary[]>> {
    const summaries = this.versions
      .filter((v) => v.flowId === flowId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(({ snapshot: _snapshot, ...summary }) => summary);
    return ok(summaries);
  }

  async getById(id: string): Promise<Result<FlowVersion | null>> {
    return ok(this.versions.find((v) => v.id === id) ?? null);
  }

  async getByNumber(flowId: string, versionNumber: number): Promise<Result<FlowVersion | null>> {
    return ok(this.versions.find((v) => v.flowId === flowId && v.versionNumber === versionNumber) ?? null);
  }

  async latestPublished(flowId: string): Promise<Result<FlowVersion | null>> {
    const published = this.versions
      .filter((v) => v.flowId === flowId && v.status === "published")
      .sort((a, b) => (b.versionNumber ?? 0) - (a.versionNumber ?? 0));
    return ok(published[0] ?? null);
  }

  async openDraft(flowId: string): Promise<Result<FlowVersion | null>> {
    return ok(this.versions.find((v) => v.flowId === flowId && v.status === "draft") ?? null);
  }
}

class FakeAuditLogger implements IAuditLogger {
  entries: NewAuditLog[] = [];
  async log(payload: NewAuditLog): Promise<Result<true>> {
    this.entries.push(payload);
    return ok(true as const);
  }
}

// ── PublishFlowVersion ───────────────────────────────────────────────────────

describe("PublishFlowVersion", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let versions: FakeFlowVersionRepository;
  let audit: FakeAuditLogger;
  let useCase: PublishFlowVersion;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    versions = new FakeFlowVersionRepository();
    audit = new FakeAuditLogger();
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());
    nodes.nodes.set("node-2", makeNode({ id: "node-2" }));
    edges.edges.set("edge-1", makeEdge());
    useCase = new PublishFlowVersion(flows, nodes, edges, versions, audit);
  });

  it("records version 1 with a complete snapshot of the live definition", async () => {
    const result = await useCase.execute({ flowId: "flow-1", publishedByUserId: "user-1" });

    expect(result.error).toBeUndefined();
    expect(result.data?.versionNumber).toBe(1);
    expect(result.data?.status).toBe("published");
    expect(result.data?.snapshot.nodes).toHaveLength(2);
    expect(result.data?.snapshot.edges).toHaveLength(1);
  });

  it("allocates the next number on a second publish", async () => {
    await useCase.execute({ flowId: "flow-1", publishedByUserId: "user-1" });
    const second = await useCase.execute({ flowId: "flow-1", publishedByUserId: "user-1" });

    expect(second.data?.versionNumber).toBe(2);
  });

  it("promotes the open draft rather than creating a parallel row", async () => {
    const draft = await versions.upsertDraft({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow(), [makeNode()], []),
    });

    const published = await useCase.execute({ flowId: "flow-1", publishedByUserId: "user-1" });

    expect(published.data?.id).toBe(draft.data?.id);
    expect(published.data?.status).toBe("published");
    expect(versions.versions.filter((v) => v.status === "draft")).toHaveLength(0);
  });

  it("stores an optional change summary", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      publishedByUserId: "user-1",
      changeSummary: "Added approval step",
    });

    expect(result.data?.changeSummary).toBe("Added approval step");
  });

  it("writes a flow.version.published audit event", async () => {
    await useCase.execute({ flowId: "flow-1", publishedByUserId: "user-1" });

    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]?.action).toBe("flow.version.published");
    expect(audit.entries[0]?.resourceId).toBe("flow-1");
  });

  it("returns NOT_FOUND when the flow does not exist", async () => {
    const result = await useCase.execute({ flowId: "missing", publishedByUserId: "user-1" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ── ListFlowVersions / GetFlowVersion ────────────────────────────────────────

describe("ListFlowVersions", () => {
  it("returns metadata summaries without the snapshot payload", async () => {
    const versions = new FakeFlowVersionRepository();
    await versions.createPublished({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow(), [makeNode()], []),
      publishedByUserId: "user-1",
    });
    const useCase = new ListFlowVersions(versions);

    const result = await useCase.execute("flow-1");

    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]).not.toHaveProperty("snapshot");
    expect(result.data?.[0]?.versionNumber).toBe(1);
  });
});

describe("GetFlowVersion", () => {
  let versions: FakeFlowVersionRepository;
  let useCase: GetFlowVersion;

  beforeEach(async () => {
    versions = new FakeFlowVersionRepository();
    await versions.createPublished({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow(), [makeNode()], []),
      publishedByUserId: "user-1",
    });
    useCase = new GetFlowVersion(versions);
  });

  it("returns the full snapshot for a version", async () => {
    const result = await useCase.execute("version-1");
    expect(result.data?.snapshot.nodes).toHaveLength(1);
  });

  it("returns NOT_FOUND for an unknown version", async () => {
    const result = await useCase.execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ── RestoreFlowVersion ───────────────────────────────────────────────────────

describe("RestoreFlowVersion", () => {
  let versions: FakeFlowVersionRepository;
  let audit: FakeAuditLogger;
  let useCase: RestoreFlowVersion;

  beforeEach(() => {
    versions = new FakeFlowVersionRepository();
    audit = new FakeAuditLogger();
    useCase = new RestoreFlowVersion(versions, audit);
  });

  it("records a new published version noting the source and writes an audit event", async () => {
    await versions.createPublished({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow({ name: "v1" }), [makeNode({ id: "keep" })], []),
      publishedByUserId: "user-1",
    });
    await versions.createPublished({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow({ name: "v2" }), [makeNode({ id: "other" })], []),
      publishedByUserId: "user-1",
    });

    const result = await useCase.execute({ versionId: "version-1", restoredByUserId: "user-1" });

    expect(result.data?.versionNumber).toBe(3);
    expect(result.data?.changeSummary).toContain("version 1");
    expect(result.data?.snapshot.nodes[0]?.id).toBe("keep");
    expect(audit.entries[0]?.action).toBe("flow.version.restored");
  });

  it("refuses to restore an unpublished draft", async () => {
    await versions.upsertDraft({
      flowId: "flow-1",
      snapshot: buildFlowSnapshot(makeFlow(), [makeNode()], []),
    });

    const result = await useCase.execute({ versionId: "version-1", restoredByUserId: "user-1" });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns NOT_FOUND for an unknown version", async () => {
    const result = await useCase.execute({ versionId: "missing", restoredByUserId: "user-1" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

// ── SyncFlowDraft ────────────────────────────────────────────────────────────

describe("SyncFlowDraft", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let versions: FakeFlowVersionRepository;
  let useCase: SyncFlowDraft;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    versions = new FakeFlowVersionRepository();
    nodes.nodes.set("node-1", makeNode());
    useCase = new SyncFlowDraft(flows, nodes, edges, versions);
  });

  it("opens a single draft when editing a published flow", async () => {
    flows.flows.set("flow-1", makeFlow({ status: "published" }));

    const first = await useCase.execute("flow-1");
    const second = await useCase.execute("flow-1");

    expect(first.data?.status).toBe("draft");
    expect(second.data?.id).toBe(first.data?.id);
    expect(versions.versions.filter((v) => v.status === "draft")).toHaveLength(1);
  });

  it("is a no-op for a never-published flow", async () => {
    flows.flows.set("flow-1", makeFlow({ status: "draft" }));

    const result = await useCase.execute("flow-1");

    expect(result.data).toBeNull();
    expect(versions.versions).toHaveLength(0);
  });
});
