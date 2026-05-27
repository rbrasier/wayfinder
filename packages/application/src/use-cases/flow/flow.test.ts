import { describe, it, expect, beforeEach } from "vitest";
import type {
  Flow,
  FlowEdge,
  FlowNode,
  NewFlow,
  NewFlowEdge,
  NewFlowNode,
  Result,
} from "@rbrasier/domain";
import { domainError, err, ok } from "@rbrasier/domain";
import type { FlowNodeUpdate, FlowUpdate } from "@rbrasier/domain";
import type { IFlowEdgeRepository, IFlowNodeRepository, IFlowRepository } from "@rbrasier/domain";
import { CreateFlow } from "./create-flow";
import { DeleteFlow } from "./delete-flow";
import { GetFlowCanvas } from "./get-flow-canvas";
import { UpdateFlow } from "./update-flow";
import { CreateFlowNode } from "./create-flow-node";
import { UpdateFlowNode } from "./update-flow-node";
import { UpdateFlowNodePosition } from "./update-flow-node-position";
import { DeleteFlowNode } from "./delete-flow-node";
import { CreateFlowEdge } from "./create-flow-edge";
import { DeleteFlowEdge } from "./delete-flow-edge";
import { GrantFlowOwner } from "./grant-flow-owner";

const makeFlow = (overrides: Partial<Flow> = {}): Flow => ({
  id: "flow-1",
  name: "Test Flow",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "draft",
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
  positionX: 100,
  positionY: 100,
  config: { aiInstruction: "Help the user.", doneWhen: "User is satisfied.", outputType: "conversation_only" },
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

class FakeFlowRepository implements IFlowRepository {
  flows: Map<string, Flow> = new Map();
  private nextId = 1;

  async create(input: NewFlow): Promise<Result<Flow>> {
    const flow: Flow = {
      id: `flow-${this.nextId++}`,
      name: input.name,
      description: input.description ?? null,
      icon: input.icon ?? null,
      expertRole: input.expertRole ?? null,
      ownerUserId: input.ownerUserId,
      status: "draft",
      visibility: { kind: "private" },
      permissions: [{ userId: input.ownerUserId, role: "owner" }],
      contextDocs: [],
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.flows.set(flow.id, flow);
    return ok(flow);
  }

  async findById(id: string): Promise<Result<Flow | null>> {
    return ok(this.flows.get(id) ?? null);
  }

  async list(): Promise<Result<Flow[]>> {
    return ok([...this.flows.values()]);
  }

  async listForUser(userId: string): Promise<Result<Flow[]>> {
    const flows = [...this.flows.values()].filter(
      (f) => f.ownerUserId === userId || f.permissions.some((p) => p.userId === userId),
    );
    return ok(flows);
  }

  async update(id: string, patch: FlowUpdate): Promise<Result<Flow>> {
    const flow = this.flows.get(id);
    if (!flow) return err(domainError("NOT_FOUND", `Flow ${id} not found.`));
    const updated = { ...flow, ...patch, updatedAt: new Date() };
    this.flows.set(id, updated);
    return ok(updated);
  }

  async addContextDoc(flowId: string, doc: import("@rbrasier/domain").FlowContextDoc): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId);
    if (!flow) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
    const updated = { ...flow, contextDocs: [...flow.contextDocs, doc], updatedAt: new Date() };
    this.flows.set(flowId, updated);
    return ok(updated);
  }

  async removeContextDoc(flowId: string, docId: string): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId);
    if (!flow) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
    const updated = { ...flow, contextDocs: flow.contextDocs.filter((d) => d.id !== docId), updatedAt: new Date() };
    this.flows.set(flowId, updated);
    return ok(updated);
  }

  async softDelete(id: string): Promise<Result<Flow>> {
    const flow = this.flows.get(id);
    if (!flow) return err(domainError("NOT_FOUND", `Flow ${id} not found.`));
    const updated = { ...flow, deletedAt: new Date(), updatedAt: new Date() };
    this.flows.set(id, updated);
    return ok(updated);
  }

  async setPermission(flowId: string, userId: string, role: import("@rbrasier/domain").FlowPermissionRole): Promise<Result<Flow>> {
    const flow = this.flows.get(flowId);
    if (!flow) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
    const permissions = flow.permissions.filter((p) => p.userId !== userId);
    permissions.push({ userId, role });
    const updated = { ...flow, permissions, updatedAt: new Date() };
    this.flows.set(flowId, updated);
    return ok(updated);
  }
}

class FakeFlowNodeRepository implements IFlowNodeRepository {
  nodes: Map<string, FlowNode> = new Map();
  private nextId = 1;

  async create(input: NewFlowNode): Promise<Result<FlowNode>> {
    const node: FlowNode = {
      id: `node-${this.nextId++}`,
      flowId: input.flowId,
      type: input.type,
      name: input.name,
      colour: input.colour ?? null,
      positionX: input.positionX,
      positionY: input.positionY,
      config: input.config,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.nodes.set(node.id, node);
    return ok(node);
  }

  async findById(id: string): Promise<Result<FlowNode | null>> {
    return ok(this.nodes.get(id) ?? null);
  }

  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    return ok([...this.nodes.values()].filter((n) => n.flowId === flowId));
  }

  async update(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>> {
    const node = this.nodes.get(id);
    if (!node) return err(domainError("NOT_FOUND", `Node ${id} not found.`));
    const updated = { ...node, ...patch, updatedAt: new Date() };
    this.nodes.set(id, updated);
    return ok(updated);
  }

  async updatePosition(id: string, x: number, y: number): Promise<Result<FlowNode>> {
    const node = this.nodes.get(id);
    if (!node) return err(domainError("NOT_FOUND", `Node ${id} not found.`));
    const updated = { ...node, positionX: x, positionY: y, updatedAt: new Date() };
    this.nodes.set(id, updated);
    return ok(updated);
  }

  async delete(id: string): Promise<Result<true>> {
    this.nodes.delete(id);
    return ok(true as const);
  }
}

class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges: Map<string, FlowEdge> = new Map();
  private nextId = 1;

  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    const edge: FlowEdge = {
      id: `edge-${this.nextId++}`,
      flowId: input.flowId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.edges.set(edge.id, edge);
    return ok(edge);
  }

  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((e) => e.flowId === flowId));
  }

  async delete(id: string): Promise<Result<true>> {
    this.edges.delete(id);
    return ok(true as const);
  }
}

describe("CreateFlow", () => {
  let flows: FakeFlowRepository;
  let useCase: CreateFlow;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    useCase = new CreateFlow(flows);
  });

  it("creates a flow in draft status with owner permission", async () => {
    const input: NewFlow = { name: "Onboarding", ownerUserId: "user-1" };
    const result = await useCase.execute(input);

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("Onboarding");
    expect(result.data?.status).toBe("draft");
    expect(result.data?.ownerUserId).toBe("user-1");
    expect(result.data?.permissions).toEqual([{ userId: "user-1", role: "owner" }]);
    expect(result.data?.expertRole).toBeNull();
  });

  it("stores expertRole when provided", async () => {
    const input: NewFlow = { name: "Legal Review", ownerUserId: "user-1", expertRole: "Senior Solicitor" };
    const result = await useCase.execute(input);

    expect(result.data?.expertRole).toBe("Senior Solicitor");
  });

  it("propagates repository errors", async () => {
    flows.create = async () => err(domainError("INFRA_FAILURE", "DB down"));
    const result = await useCase.execute({ name: "Flow", ownerUserId: "user-1" });
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("UpdateFlow", () => {
  let flows: FakeFlowRepository;
  let useCase: UpdateFlow;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    flows.flows.set("flow-1", makeFlow());
    useCase = new UpdateFlow(flows);
  });

  it("updates flow name", async () => {
    const result = await useCase.execute("flow-1", { name: "New Name" });
    expect(result.data?.name).toBe("New Name");
  });

  it("publishes a flow", async () => {
    const result = await useCase.execute("flow-1", { status: "published" });
    expect(result.data?.status).toBe("published");
  });

  it("returns NOT_FOUND when flow does not exist", async () => {
    const result = await useCase.execute("missing", { name: "X" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("allows a non-admin to set visibility to private", async () => {
    const result = await useCase.execute(
      "flow-1",
      { visibility: { kind: "private" } },
      { isAdmin: false },
    );
    expect(result.data?.visibility).toEqual({ kind: "private" });
  });

  it("forbids a non-admin from setting visibility to global", async () => {
    const result = await useCase.execute(
      "flow-1",
      { visibility: { kind: "global" } },
      { isAdmin: false },
    );
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("allows an admin to set visibility to global", async () => {
    const result = await useCase.execute(
      "flow-1",
      { visibility: { kind: "global" } },
      { isAdmin: true },
    );
    expect(result.data?.visibility).toEqual({ kind: "global" });
  });

  it("treats omitted caller context as non-admin", async () => {
    const result = await useCase.execute("flow-1", { visibility: { kind: "global" } });
    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("GetFlowCanvas", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let useCase: GetFlowCanvas;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode());
    edges.edges.set("edge-1", makeEdge());
    useCase = new GetFlowCanvas(flows, nodes, edges);
  });

  it("returns flow with nodes and edges", async () => {
    const result = await useCase.execute("flow-1");
    expect(result.data?.flow.id).toBe("flow-1");
    expect(result.data?.nodes).toHaveLength(1);
    expect(result.data?.edges).toHaveLength(1);
  });

  it("returns null when flow does not exist", async () => {
    const result = await useCase.execute("missing");
    expect(result.data).toBeNull();
  });
});

describe("CreateFlowNode", () => {
  let nodes: FakeFlowNodeRepository;
  let useCase: CreateFlowNode;

  beforeEach(() => {
    nodes = new FakeFlowNodeRepository();
    useCase = new CreateFlowNode(nodes);
  });

  it("creates a conversational node", async () => {
    const input: NewFlowNode = {
      flowId: "flow-1",
      type: "conversational",
      name: "Welcome",
      positionX: 50,
      positionY: 100,
      config: {},
    };
    const result = await useCase.execute(input);
    expect(result.data?.name).toBe("Welcome");
    expect(result.data?.flowId).toBe("flow-1");
    expect(result.data?.positionX).toBe(50);
  });
});

describe("UpdateFlowNode", () => {
  let nodes: FakeFlowNodeRepository;
  let useCase: UpdateFlowNode;

  beforeEach(() => {
    nodes = new FakeFlowNodeRepository();
    nodes.nodes.set("node-1", makeNode());
    useCase = new UpdateFlowNode(nodes);
  });

  it("updates node config", async () => {
    const result = await useCase.execute("node-1", {
      config: { aiInstruction: "Do this.", doneWhen: "Done.", outputType: "conversation_only" },
    });
    expect((result.data?.config as Record<string, unknown>).aiInstruction).toBe("Do this.");
  });

  it("returns NOT_FOUND for missing node", async () => {
    const result = await useCase.execute("missing", { name: "X" });
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("UpdateFlowNodePosition", () => {
  let nodes: FakeFlowNodeRepository;
  let useCase: UpdateFlowNodePosition;

  beforeEach(() => {
    nodes = new FakeFlowNodeRepository();
    nodes.nodes.set("node-1", makeNode());
    useCase = new UpdateFlowNodePosition(nodes);
  });

  it("updates node position", async () => {
    const result = await useCase.execute("node-1", 300, 400);
    expect(result.data?.positionX).toBe(300);
    expect(result.data?.positionY).toBe(400);
  });
});

describe("DeleteFlowNode", () => {
  let nodes: FakeFlowNodeRepository;
  let useCase: DeleteFlowNode;

  beforeEach(() => {
    nodes = new FakeFlowNodeRepository();
    nodes.nodes.set("node-1", makeNode());
    useCase = new DeleteFlowNode(nodes);
  });

  it("deletes a node", async () => {
    const result = await useCase.execute("node-1");
    expect(result.data).toBe(true);
    expect(nodes.nodes.has("node-1")).toBe(false);
  });
});

describe("CreateFlowEdge", () => {
  let edges: FakeFlowEdgeRepository;
  let useCase: CreateFlowEdge;

  beforeEach(() => {
    edges = new FakeFlowEdgeRepository();
    useCase = new CreateFlowEdge(edges);
  });

  it("creates an edge between two nodes", async () => {
    const input: NewFlowEdge = { flowId: "flow-1", fromNodeId: "node-1", toNodeId: "node-2" };
    const result = await useCase.execute(input);
    expect(result.data?.fromNodeId).toBe("node-1");
    expect(result.data?.toNodeId).toBe("node-2");
  });
});

describe("DeleteFlowEdge", () => {
  let edges: FakeFlowEdgeRepository;
  let useCase: DeleteFlowEdge;

  beforeEach(() => {
    edges = new FakeFlowEdgeRepository();
    edges.edges.set("edge-1", makeEdge());
    useCase = new DeleteFlowEdge(edges);
  });

  it("deletes an edge", async () => {
    const result = await useCase.execute("edge-1");
    expect(result.data).toBe(true);
    expect(edges.edges.has("edge-1")).toBe(false);
  });
});

describe("GrantFlowOwner", () => {
  let flows: FakeFlowRepository;
  let useCase: GrantFlowOwner;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    flows.flows.set("flow-1", makeFlow());
    useCase = new GrantFlowOwner(flows);
  });

  it("grants owner permission to a user and updates ownerUserId", async () => {
    const result = await useCase.execute("flow-1", "user-2");
    expect(result.data?.ownerUserId).toBe("user-2");
    expect(result.data?.permissions.some((p) => p.userId === "user-2" && p.role === "owner")).toBe(true);
  });

  it("returns NOT_FOUND when flow does not exist", async () => {
    const result = await useCase.execute("missing", "user-2");
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("DeleteFlow", () => {
  let flows: FakeFlowRepository;
  let useCase: DeleteFlow;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    flows.flows.set("flow-1", makeFlow());
    useCase = new DeleteFlow(flows);
  });

  it("soft-deletes a flow by setting deletedAt", async () => {
    const result = await useCase.execute("flow-1");
    expect(result.error).toBeUndefined();
    expect(result.data?.deletedAt).not.toBeNull();
    expect(result.data?.id).toBe("flow-1");
  });

  it("returns NOT_FOUND when flow does not exist", async () => {
    const result = await useCase.execute("missing");
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("propagates repository errors", async () => {
    flows.softDelete = async () => err(domainError("INFRA_FAILURE", "DB down"));
    const result = await useCase.execute("flow-1");
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
