import { domainError, err, ok, type FlowEdge, type IFlowEdgeRepository, type NewFlowEdge, type Result } from "@wayfinder/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { SetFlowEdgeBranchRule } from "./set-flow-edge-branch-rule";

const makeEdge = (overrides: Partial<FlowEdge> = {}): FlowEdge => ({
  id: "edge-1",
  flowId: "flow-1",
  fromNodeId: "node-1",
  toNodeId: "node-2",
  config: {},
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  ...overrides,
});

class FakeFlowEdgeRepository implements IFlowEdgeRepository {
  edges = new Map<string, FlowEdge>();
  failUpdate: boolean = false;

  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    const edge = makeEdge({ ...input, config: input.config ?? {} });
    this.edges.set(edge.id, edge);
    return ok(edge);
  }

  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    return ok([...this.edges.values()].filter((edge) => edge.flowId === flowId));
  }

  async findById(id: string): Promise<Result<FlowEdge | null>> {
    return ok(this.edges.get(id) ?? null);
  }

  async updateConfig(id: string, config: Record<string, unknown>): Promise<Result<FlowEdge>> {
    if (this.failUpdate) return err(domainError("INFRA_FAILURE", "update failed"));
    const existing = this.edges.get(id);
    if (!existing) return err(domainError("NOT_FOUND", "Flow edge not found."));
    const updated = { ...existing, config };
    this.edges.set(id, updated);
    return ok(updated);
  }

  async delete(id: string): Promise<Result<true>> {
    this.edges.delete(id);
    return ok(true as const);
  }
}

describe("SetFlowEdgeBranchRule", () => {
  let edges: FakeFlowEdgeRepository;
  let useCase: SetFlowEdgeBranchRule;

  beforeEach(() => {
    edges = new FakeFlowEdgeRepository();
    edges.edges.set("edge-1", makeEdge());
    useCase = new SetFlowEdgeBranchRule(edges);
  });

  it("stores the rule on the edge", async () => {
    const result = await useCase.execute({ edgeId: "edge-1", rule: "the claim is over £10,000" });

    expect(result.error).toBeUndefined();
    expect(result.data?.config).toEqual({ branchRule: "the claim is over £10,000" });
  });

  it("trims the rule before storing it", async () => {
    const result = await useCase.execute({ edgeId: "edge-1", rule: "  spend is over £50k  " });

    expect(result.data?.config).toEqual({ branchRule: "spend is over £50k" });
  });

  it("clears the rule when given null", async () => {
    edges.edges.set("edge-1", makeEdge({ config: { branchRule: "old rule" } }));

    const result = await useCase.execute({ edgeId: "edge-1", rule: null });

    expect(result.data?.config).toEqual({});
  });

  it("clears the rule when given a blank string, so an emptied input removes it", async () => {
    edges.edges.set("edge-1", makeEdge({ config: { branchRule: "old rule" } }));

    const result = await useCase.execute({ edgeId: "edge-1", rule: "   " });

    expect(result.data?.config).toEqual({});
  });

  it("preserves unrelated config keys already on the edge", async () => {
    edges.edges.set("edge-1", makeEdge({ config: { label: "fast track" } }));

    const result = await useCase.execute({ edgeId: "edge-1", rule: "spend is under £1k" });

    expect(result.data?.config).toEqual({ label: "fast track", branchRule: "spend is under £1k" });
  });

  it("returns NOT_FOUND for an edge that does not exist", async () => {
    const result = await useCase.execute({ edgeId: "missing", rule: "anything" });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("returns the repository error when the update fails", async () => {
    edges.failUpdate = true;

    const result = await useCase.execute({ edgeId: "edge-1", rule: "anything" });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
