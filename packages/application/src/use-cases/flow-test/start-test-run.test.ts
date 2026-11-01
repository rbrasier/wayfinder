import { beforeEach, describe, expect, it } from "vitest";
import type { FlowTestSeed } from "@wayfinder/domain";
import { StartSession } from "../session/start-session";
import { StartTestRun } from "./start-test-run";
import {
  FakeFlowEdgeRepository,
  FakeFlowNodeRepository,
  FakeFlowRepository,
  FakeFlowVersionRepository,
  FakeSessionMessageRepository,
  FakeSessionRepository,
  FakeSessionStepOutputRepository,
  makeFlow,
  makeNode,
} from "./__fixtures__/flow-test-doubles";

const seedWith = (seed: Partial<FlowTestSeed>): FlowTestSeed => ({
  gatheredContext: [],
  stepOutputs: [],
  ...seed,
});

describe("StartTestRun", () => {
  let flows: FakeFlowRepository;
  let nodes: FakeFlowNodeRepository;
  let edges: FakeFlowEdgeRepository;
  let versions: FakeFlowVersionRepository;
  let sessions: FakeSessionRepository;
  let messages: FakeSessionMessageRepository;
  let stepOutputs: FakeSessionStepOutputRepository;
  let useCase: StartTestRun;

  beforeEach(() => {
    flows = new FakeFlowRepository();
    nodes = new FakeFlowNodeRepository();
    edges = new FakeFlowEdgeRepository();
    versions = new FakeFlowVersionRepository();
    sessions = new FakeSessionRepository();
    messages = new FakeSessionMessageRepository();
    stepOutputs = new FakeSessionStepOutputRepository();

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

    useCase = new StartTestRun(
      new StartSession(sessions, flows, nodes, edges, versions),
      nodes,
      messages,
      stepOutputs,
    );
  });

  it("writes gathered context that reads back through the unchanged aggregate query", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        gatheredContext: [
          { nodeId: "node-1", key: "supplier", value: "Acme Ltd" },
          { nodeId: "node-1", key: "budget", value: "50000" },
        ],
      }),
    });

    expect(result.error).toBeUndefined();
    const sessionId = result.data!.session.id;

    const aggregated = await messages.aggregateGatheredContext(sessionId);
    expect(aggregated.data).toEqual([
      { key: "supplier", value: "Acme Ltd" },
      { key: "budget", value: "50000" },
    ]);
  });

  it("anchors each seeded message to its node, as the aggregate query requires", async () => {
    await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        gatheredContext: [{ nodeId: "node-1", key: "supplier", value: "Acme Ltd" }],
      }),
    });

    const [message] = messages.messages;
    expect(message?.role).toBe("assistant");
    expect(message?.stepNodeId).toBe("node-1");
    expect(message?.aiPayload?.contextGathered).toEqual([{ key: "supplier", value: "Acme Ltd" }]);
  });

  it("writes one message per seeded node rather than one per item", async () => {
    await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        gatheredContext: [
          { nodeId: "node-1", key: "supplier", value: "Acme Ltd" },
          { nodeId: "node-1", key: "budget", value: "50000" },
          { nodeId: "node-2", key: "urgency", value: "High" },
        ],
      }),
    });

    expect(messages.messages).toHaveLength(2);
    expect(messages.messages.map((message) => message.stepNodeId)).toEqual(["node-1", "node-2"]);
  });

  it("creates a step-output row per seeded node in the existing field shape", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        stepOutputs: [
          {
            nodeId: "node-1",
            fields: [{ key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" }],
          },
        ],
      }),
    });

    expect(result.error).toBeUndefined();
    expect(stepOutputs.outputs).toHaveLength(1);
    expect(stepOutputs.outputs[0]?.nodeId).toBe("node-1");
    expect(stepOutputs.outputs[0]?.sessionId).toBe(result.data!.session.id);
    expect(stepOutputs.outputs[0]?.fields).toEqual([
      { key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" },
    ]);
  });

  it("returns rejects and does not write the values they refer to", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        stepOutputs: [
          {
            nodeId: "node-1",
            fields: [{ key: "invented", label: "Invented", type: "text", value: "anything" }],
          },
        ],
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.rejects).toHaveLength(1);
    expect(result.data?.rejects[0]?.key).toBe("invented");
    expect(stepOutputs.outputs).toEqual([]);
  });

  it("writes nothing at all for an empty seed, which is a whole-flow run", async () => {
    const result = await useCase.execute({ flowId: "flow-1", userId: "author-1" });

    expect(result.error).toBeUndefined();
    expect(messages.messages).toEqual([]);
    expect(stepOutputs.outputs).toEqual([]);
    expect(result.data?.session.currentNodeId).toBe("node-1");
  });

  it("marks the session as a test run resolved from the live rows", async () => {
    const result = await useCase.execute({ flowId: "flow-1", userId: "author-1" });

    expect(result.data?.session.mode).toBe("test");
    expect(result.data?.session.flowVersionId).toBeNull();
  });

  it("refuses a caller with no edit rights before writing anything", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      userId: "operator-9",
      seed: seedWith({
        gatheredContext: [{ nodeId: "node-1", key: "supplier", value: "Acme Ltd" }],
      }),
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(messages.messages).toEqual([]);
    expect(stepOutputs.outputs).toEqual([]);
    expect(sessions.sessions.size).toBe(0);
  });

  it("reports a seed aimed at a deleted node without starting a broken run", async () => {
    const result = await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      seed: seedWith({
        gatheredContext: [{ nodeId: "node-gone", key: "supplier", value: "Acme Ltd" }],
      }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.rejects).toHaveLength(1);
    expect(messages.messages).toEqual([]);
  });

  it("canonicalises a seeded value on the way in", async () => {
    nodes.nodes.set(
      "node-1",
      makeNode({
        id: "node-1",
        config: {
          aiInstruction: "Find out what they need.",
          doneWhen: "Requirements are clear.",
          outputType: "structured",
          structuredFields: [
            { key: "urgent", label: "Urgent", type: "yesno", optional: false, raw: "Urgent (yesno)" },
          ],
        },
      }),
    );

    await useCase.execute({
      flowId: "flow-1",
      userId: "author-1",
      startNodeId: "node-2",
      seed: seedWith({
        stepOutputs: [
          {
            nodeId: "node-1",
            fields: [{ key: "urgent", label: "Urgent", type: "yesno", value: "yes" }],
          },
        ],
      }),
    });

    expect(stepOutputs.outputs[0]?.fields[0]?.value).toBe("Yes");
  });
});
