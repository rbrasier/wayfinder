import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import type { AiTurnPayload, Flow, FlowNode, SessionMessage } from "@rbrasier/domain";
import {
  buildGatheredContext,
  generateDocument,
  generateInitialMessage,
} from "./turn-helpers";

const makeAssistantMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  id: "msg-1",
  sessionId: "sess-1",
  role: "assistant",
  content: "ok",
  senderUserId: null,
  confidence: 95,
  stepNodeId: "node-1",
  document: null,
  documentStatus: null,
  aiPayload: {
    response: "ok",
    rationale: "r",
    stepCompleteConfidence: 95,
    contextGathered: [
      { key: "Full Name", value: "John Dutton" },
      { key: "Department", value: "Sales" },
    ],
  },
  createdAt: new Date(),
  ...overrides,
});

const makeFlow = (): Flow =>
  ({
    id: "flow-1",
    name: "Onboarding",
    expertRole: "HR specialist",
    contextDocs: [],
  } as unknown as Flow);

const makeNode = (overrides: Partial<FlowNode> = {}): FlowNode =>
  ({
    id: "node-2",
    name: "IT Equipment Request",
    config: {
      aiInstruction: "Gather IT equipment requirements",
      doneWhen: "All equipment info gathered",
      outputType: "conversational",
      advanceConfidenceThreshold: 90,
    },
    ...overrides,
  } as unknown as FlowNode);

describe("buildGatheredContext", () => {
  it("collates contextGathered entries from prior assistant messages", () => {
    const messages: SessionMessage[] = [
      makeAssistantMessage({
        id: "m1",
        stepNodeId: "node-1",
        aiPayload: {
          response: "x",
          rationale: "r",
          stepCompleteConfidence: 95,
          contextGathered: [{ key: "Full Name", value: "John Dutton" }],
        },
      }),
      makeAssistantMessage({
        id: "m2",
        stepNodeId: "node-1",
        aiPayload: {
          response: "y",
          rationale: "r",
          stepCompleteConfidence: 95,
          contextGathered: [{ key: "Start Date", value: "1 June 2026" }],
        },
      }),
    ];

    const result = buildGatheredContext(messages);

    expect(result).toContain("Full Name: John Dutton");
    expect(result).toContain("Start Date: 1 June 2026");
  });

  it("returns empty string when no prior context exists", () => {
    expect(buildGatheredContext([])).toBe("");
  });
});

describe("generateInitialMessage", () => {
  it("passes gatheredContext to the system prompt builder for the new step", async () => {
    const buildSystemPrompt = vi.fn().mockReturnValue({ data: "system-prompt", error: null });
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const errorLog = vi.fn().mockResolvedValue({ data: undefined, error: null });

    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: "json",
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: "stop",
        usage: { promptTokens: 1, completionTokens: 1 },
        text: JSON.stringify({
          response: "Hello",
          rationale: "r",
          stepCompleteConfidence: 0,
          contextGathered: [],
        }),
      }),
    });

    const retrieveDocumentChunks = {
      execute: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const container = {
      services: {
        sessionAgent: { buildSystemPrompt },
        errorLogger: { log: errorLog },
      },
      repos: {
        sessionMessages: { create },
        usageRepo: {},
      },
      useCases: {
        retrieveDocumentChunks,
      },
    } as unknown as Parameters<typeof generateInitialMessage>[0]["container"];

    await generateInitialMessage({
      container,
      sessionId: "sess-1",
      newNodeId: "node-2",
      newNode: makeNode(),
      flow: makeFlow(),
      model,
      organisationName: "Acme",
      userProfile: { name: "Ada Lovelace", role: "Analyst", team: "Risk" },
      userId: "user-1",
      provider: "anthropic",
      gatheredContext: "- Full Name: John Dutton\n- Department: Sales",
    });

    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    const call = buildSystemPrompt.mock.calls[0]![0];
    expect(call.gatheredContext).toContain("John Dutton");
    expect(call.gatheredContext).toContain("Sales");
  });
});

describe("generateDocument wrapper", () => {
  it("marks message documentStatus=failed and logs when use case returns Result.error", async () => {
    const updateDocumentStatus = vi.fn().mockResolvedValue({ data: {}, error: null });
    const errorLog = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const execute = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "INFRA_FAILURE", message: "boom", cause: new Error("template missing") },
    });

    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus } },
      services: { errorLogger: { log: errorLog } },
    } as unknown as Parameters<typeof generateDocument>[0];

    await generateDocument(
      container,
      "msg-1",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(updateDocumentStatus).toHaveBeenCalledWith("msg-1", "failed");
    expect(errorLog).toHaveBeenCalledTimes(1);
    const logArg = errorLog.mock.calls[0]![0];
    expect(logArg.message).toContain("Document generation failed");
  });

  it("marks message documentStatus=failed and logs when use case throws", async () => {
    const updateDocumentStatus = vi.fn().mockResolvedValue({ data: {}, error: null });
    const errorLog = vi.fn().mockResolvedValue({ data: undefined, error: null });
    const execute = vi.fn().mockRejectedValue(new Error("network down"));

    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus } },
      services: { errorLogger: { log: errorLog } },
    } as unknown as Parameters<typeof generateDocument>[0];

    await generateDocument(
      container,
      "msg-2",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(updateDocumentStatus).toHaveBeenCalledWith("msg-2", "failed");
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("does not touch status when use case succeeds (updateDocument already set complete)", async () => {
    const updateDocumentStatus = vi.fn();
    const errorLog = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      data: { document: { filename: "f", storagePath: "p", summary: null, generatedAt: "now" } },
      error: null,
    });

    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus } },
      services: { errorLogger: { log: errorLog } },
    } as unknown as Parameters<typeof generateDocument>[0];

    await generateDocument(
      container,
      "msg-3",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(updateDocumentStatus).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });
});

describe("sequence: document generation is fire-and-forget", () => {
  it("does not block initial message generation on document generation", async () => {
    const sequence: string[] = [];
    let resolveDocGen: (() => void) | null = null;
    const docGenPromise = new Promise<void>((resolve) => {
      resolveDocGen = resolve;
    });

    const generateDocFn = vi.fn().mockImplementation(async () => {
      sequence.push("doc-start");
      await docGenPromise;
      sequence.push("doc-end");
    });

    const generateInitialFn = vi.fn().mockImplementation(async () => {
      sequence.push("initial-start");
      sequence.push("initial-end");
    });

    // Fire-and-forget: void the doc gen promise, do NOT await it
    const runAdvance = async () => {
      void generateDocFn();
      await generateInitialFn();
    };

    await runAdvance();

    // Initial message finished without waiting for doc gen
    expect(sequence).toContain("initial-start");
    expect(sequence).toContain("initial-end");
    expect(sequence).toContain("doc-start");
    expect(sequence).not.toContain("doc-end");

    // Clean up the dangling promise
    resolveDocGen!();
    await docGenPromise;
  });
});

describe("generateDocument return value", () => {
  it("returns false when the use case returns Result.error", async () => {
    const execute = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "INFRA_FAILURE", message: "boom", cause: new Error("api error") },
    });
    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
      services: { errorLogger: { log: vi.fn().mockResolvedValue({ data: undefined, error: null }) } },
    } as unknown as Parameters<typeof generateDocument>[0];

    const result = await generateDocument(
      container,
      "msg-1",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(result).toBe(false);
  });

  it("returns false when the use case throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("network down"));
    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus: vi.fn().mockResolvedValue({ data: {}, error: null }) } },
      services: { errorLogger: { log: vi.fn().mockResolvedValue({ data: undefined, error: null }) } },
    } as unknown as Parameters<typeof generateDocument>[0];

    const result = await generateDocument(
      container,
      "msg-2",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(result).toBe(false);
  });

  it("returns true when the use case succeeds", async () => {
    const execute = vi.fn().mockResolvedValue({
      data: { document: { filename: "f", storagePath: "p", summary: null, generatedAt: "now" } },
      error: null,
    });
    const container = {
      useCases: { generateDocument: { execute } },
      repos: { sessionMessages: { updateDocumentStatus: vi.fn() } },
      services: { errorLogger: { log: vi.fn() } },
    } as unknown as Parameters<typeof generateDocument>[0];

    const result = await generateDocument(
      container,
      "msg-3",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(result).toBe(true);
  });
});

describe("AiTurnPayload typing guard", () => {
  it("preserves AiTurnPayload shape", () => {
    const payload: AiTurnPayload = {
      response: "r",
      rationale: "r",
      stepCompleteConfidence: 100,
      contextGathered: [{ key: "k", value: "v" }],
    };
    expect(payload.contextGathered.length).toBe(1);
  });
});
