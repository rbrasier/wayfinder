import { beforeEach, describe, expect, it } from "vitest";
import { domainError, err, ok, type FlowTestSeed, type ISeedProposer, type Result, type SeedProposalRequest } from "@wayfinder/domain";
import { GenerateSeed } from "./generate-seed";
import {
  FakeFlowEdgeRepository,
  FakeFlowNodeRepository,
  FakeFlowRepository,
  makeFlow,
  makeNode,
} from "./__fixtures__/flow-test-doubles";

class FakeSeedProposer implements ISeedProposer {
  seen: SeedProposalRequest | null = null;
  response: Result<FlowTestSeed> = ok({ gatheredContext: [], stepOutputs: [] });

  async propose(request: SeedProposalRequest): Promise<Result<FlowTestSeed>> {
    this.seen = request;
    return this.response;
  }
}

describe("GenerateSeed", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let proposer: FakeSeedProposer;
  let useCase: GenerateSeed;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    proposer = new FakeSeedProposer();

    flows.flows.set("flow-1", makeFlow());
    nodes.nodes.set("node-1", makeNode({ id: "node-1", name: "Gather requirements" }));
    nodes.nodes.set("node-2", makeNode({ id: "node-2", name: "Draft the request" }));
    edges.edges.set("edge-1", {
      id: "edge-1",
      flowId: "flow-1",
      fromNodeId: "node-1",
      toNodeId: "node-2",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    useCase = new GenerateSeed(flows, nodes, edges, proposer);
  });

  it("asks the proposer only about the steps that precede the node under test", async () => {
    await useCase.execute({ flowId: "flow-1", startNodeId: "node-2", userId: "author-1" });

    expect(proposer.seen?.nodes.map((node) => node.nodeId)).toEqual(["node-1"]);
    expect(proposer.seen?.flowName).toBe("Procurement Request");
  });

  it("passes each prior step's declared fields so values are type-correct by construction", async () => {
    await useCase.execute({ flowId: "flow-1", startNodeId: "node-2", userId: "author-1" });

    expect(proposer.seen?.nodes[0]?.fields.map((field) => field.key)).toEqual(["supplier"]);
  });

  it("returns a valid proposal as the seed", async () => {
    proposer.response = ok({
      gatheredContext: [{ nodeId: "node-1", key: "supplier", value: "Acme Ltd" }],
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" }],
        },
      ],
    });

    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-2",
      userId: "author-1",
    });

    expect(result.data?.rejects).toEqual([]);
    expect(result.data?.seed.stepOutputs[0]?.fields[0]?.value).toBe("Acme Ltd");
    expect(result.data?.failureReason).toBeNull();
  });

  it("reports an invalid proposed value rather than offering it", async () => {
    nodes.nodes.set(
      "node-1",
      makeNode({
        id: "node-1",
        config: {
          aiInstruction: "Find out what they need.",
          doneWhen: "Requirements are clear.",
          outputType: "structured",
          structuredFields: [
            { key: "contact", label: "Contact", type: "email", optional: false, raw: "Contact (email)" },
          ],
        },
      }),
    );
    proposer.response = ok({
      gatheredContext: [],
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "contact", label: "Contact", type: "email", value: "not-an-email" }],
        },
      ],
    });

    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-2",
      userId: "author-1",
    });

    expect(result.data?.rejects).toHaveLength(1);
    expect(result.data?.seed.stepOutputs).toEqual([]);
  });

  it("drops a key the proposer invented", async () => {
    proposer.response = ok({
      gatheredContext: [],
      stepOutputs: [
        {
          nodeId: "node-1",
          fields: [{ key: "hallucinated", label: "Hallucinated", type: "text", value: "x" }],
        },
      ],
    });

    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-2",
      userId: "author-1",
    });

    expect(result.data?.rejects[0]?.key).toBe("hallucinated");
    expect(result.data?.seed.stepOutputs).toEqual([]);
  });

  it("degrades a proposer failure to an empty seed, with the reason, rather than throwing", async () => {
    proposer.response = err(domainError("AI_PROVIDER_FAILED", "The model is unavailable."));

    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-2",
      userId: "author-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.seed).toEqual({ gatheredContext: [], stepOutputs: [] });
    expect(result.data?.failureReason).toBe("The model is unavailable.");
  });

  it("returns an empty seed without calling the proposer when nothing precedes the node", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-1",
      userId: "author-1",
    });

    expect(proposer.seen).toBeNull();
    expect(result.data?.seed).toEqual({ gatheredContext: [], stepOutputs: [] });
  });

  it("refuses a caller with no edit rights on the flow", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      startNodeId: "node-2",
      userId: "operator-9",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(proposer.seen).toBeNull();
  });

  it("returns NOT_FOUND for a flow that does not exist", async () => {
    const result = await useCase.execute({
      flowId: "missing",
      startNodeId: "node-2",
      userId: "author-1",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
