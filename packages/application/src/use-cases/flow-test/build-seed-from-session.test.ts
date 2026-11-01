import { beforeEach, describe, expect, it } from "vitest";
import { BuildSeedFromSession } from "./build-seed-from-session";
import {
  FakeFlowRepository,
  FakeSessionMessageRepository,
  FakeSessionRepository,
  FakeSessionStepOutputRepository,
  makeFlow,
  makeSession,
} from "./__fixtures__/flow-test-doubles";

describe("BuildSeedFromSession", () => {
  let flows: FakeFlowRepository;
  let sessions: FakeSessionRepository;
  let messages: FakeSessionMessageRepository;
  let stepOutputs: FakeSessionStepOutputRepository;
  let useCase: BuildSeedFromSession;

  beforeEach(async () => {
    flows = new FakeFlowRepository();
    sessions = new FakeSessionRepository();
    messages = new FakeSessionMessageRepository();
    stepOutputs = new FakeSessionStepOutputRepository();

    flows.flows.set("flow-1", makeFlow());
    sessions.sessions.set("source-1", makeSession({ id: "source-1", userId: "operator-3" }));

    // A real run: step 1 gathered, step 2 gathered, then step 3 started.
    await messages.create({
      sessionId: "source-1",
      role: "assistant",
      content: "Noted.",
      stepNodeId: "node-1",
      aiPayload: {
        response: "Noted.",
        rationale: "",
        stepCompleteConfidence: 0.9,
        contextGathered: [{ key: "supplier", value: "Acme Ltd" }],
      },
    });
    await messages.create({
      sessionId: "source-1",
      role: "assistant",
      content: "Noted.",
      stepNodeId: "node-2",
      aiPayload: {
        response: "Noted.",
        rationale: "",
        stepCompleteConfidence: 0.9,
        contextGathered: [{ key: "budget", value: "50000" }],
      },
    });
    await messages.create({
      sessionId: "source-1",
      role: "assistant",
      content: "Now drafting.",
      stepNodeId: "node-3",
      aiPayload: {
        response: "Now drafting.",
        rationale: "",
        stepCompleteConfidence: 0.2,
        contextGathered: [{ key: "draft_started", value: "true" }],
      },
    });

    await stepOutputs.create({
      sessionId: "source-1",
      flowId: "flow-1",
      nodeId: "node-1",
      fields: [{ key: "supplier", label: "Supplier", type: "text", value: "Acme Ltd" }],
    });
    await stepOutputs.create({
      sessionId: "source-1",
      flowId: "flow-1",
      nodeId: "node-3",
      fields: [{ key: "draft", label: "Draft", type: "text", value: "Half written" }],
    });

    useCase = new BuildSeedFromSession(sessions, flows, messages, stepOutputs);
  });

  it("copies the gathered context recorded before the node under test", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.seed.gatheredContext).toEqual([
      { nodeId: "node-1", key: "supplier", value: "Acme Ltd" },
      { nodeId: "node-2", key: "budget", value: "50000" },
    ]);
  });

  it("stops at the node under test rather than copying its own turns", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    const nodeIds = result.data!.seed.gatheredContext.map((item) => item.nodeId);
    expect(nodeIds).not.toContain("node-3");
  });

  it("copies step outputs only for the steps before the node under test", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    expect(result.data?.seed.stepOutputs).toHaveLength(1);
    expect(result.data?.seed.stepOutputs[0]?.nodeId).toBe("node-1");
  });

  it("copies nothing but context and step outputs — a generated document does not travel", async () => {
    await messages.create({
      sessionId: "source-1",
      role: "assistant",
      content: "Here is your document.",
      stepNodeId: "node-2",
      document: {
        filename: "request.docx",
        storagePath: "documents/request.docx",
        summary: null,
        generatedAt: "2026-01-01T00:00:00Z",
      },
      aiPayload: {
        response: "Here is your document.",
        rationale: "",
        stepCompleteConfidence: 1,
        contextGathered: [{ key: "document_ready", value: "true" }],
      },
    });

    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    expect(JSON.stringify(result.data?.seed)).not.toContain("request.docx");
  });

  it("copies the whole run when the node under test was never reached", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-never-run",
      userId: "author-1",
    });

    expect(result.data?.seed.gatheredContext).toHaveLength(3);
  });

  it("refuses a caller who cannot edit the flow the session belongs to", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "nosy-user",
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("allows an admin to clone a session they did not run", async () => {
    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "admin-1",
      isAdmin: true,
    });

    expect(result.error).toBeUndefined();
  });

  it("returns NOT_FOUND for a session that does not exist", async () => {
    const result = await useCase.execute({
      sessionId: "missing",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("ignores user messages, which carry no gathered context", async () => {
    await messages.create({
      sessionId: "source-1",
      role: "user",
      content: "We need laptops",
      senderUserId: "operator-3",
      stepNodeId: "node-1",
    });

    const result = await useCase.execute({
      sessionId: "source-1",
      upToNodeId: "node-3",
      userId: "author-1",
    });

    expect(result.data?.seed.gatheredContext).toHaveLength(2);
  });
});
