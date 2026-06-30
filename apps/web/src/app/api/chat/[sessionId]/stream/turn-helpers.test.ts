import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV1, simulateReadableStream } from "ai/test";
import type { AiTurnPayload, Flow, FlowNode, SessionMessage, SessionUpload } from "@rbrasier/domain";
import {
  appendShortcomingsToContext,
  applyAdvanceSideEffects,
  buildAttachmentAnnotation,
  buildGatheredContext,
  buildPromptSessionUploads,
  generateDocument,
  generateInitialMessage,
  OUTSTANDING_CONTEXT_KEY,
  streamGapFollowup,
} from "./turn-helpers";
import type { Session } from "@rbrasier/domain";

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
        sessionUploads: { listBySession: vi.fn().mockResolvedValue({ data: [], error: null }) },
        usageRepo: {},
      },
      runtimeConfig: {
        getSessionUploadConfig: vi.fn().mockResolvedValue({ maxFileSizeBytes: 1, totalBudgetChars: 1000 }),
      },
      useCases: {
        retrieveDocumentChunks,
        resolveStepSkills: { execute: vi.fn().mockResolvedValue({ data: [], error: null }) },
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
      globalInstructions: "Use Australian English spelling.",
    });

    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    const call = buildSystemPrompt.mock.calls[0]![0];
    expect(call.gatheredContext).toContain("John Dutton");
    expect(call.gatheredContext).toContain("Sales");
    expect(call.globalInstructions).toBe("Use Australian English spelling.");
  });
});

describe("buildPromptSessionUploads", () => {
  const makeUpload = (overrides: Partial<SessionUpload> = {}): SessionUpload => ({
    id: "u-1",
    sessionId: "sess-1",
    messageId: null,
    filename: "doc.txt",
    mimeType: "text/plain",
    sizeBytes: 10,
    storagePath: "session/sess-1/doc.txt",
    extractedText: "hello world",
    extractionStatus: "complete",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  it("includes completed uploads with extracted text", () => {
    const result = buildPromptSessionUploads([makeUpload()], 1000);
    expect(result).toEqual([{ filename: "doc.txt", extractedText: "hello world" }]);
  });

  it("skips uploads still extracting or with no text", () => {
    const result = buildPromptSessionUploads(
      [
        makeUpload({ id: "u-2", extractionStatus: "pending", extractedText: null }),
        makeUpload({ id: "u-3", extractedText: "   " }),
      ],
      1000,
    );
    expect(result).toEqual([]);
  });

  it("truncates extracted text to the remaining budget and marks it", () => {
    const result = buildPromptSessionUploads([makeUpload({ extractedText: "abcdefghij" })], 4);
    expect(result[0]!.extractedText).toContain("abcd");
    expect(result[0]!.extractedText).toContain("[Document truncated to fit the context budget.]");
  });
});

describe("buildAttachmentAnnotation", () => {
  it("returns empty when there are no uploads", () => {
    expect(buildAttachmentAnnotation([])).toBe("");
  });

  it("lists the attached filenames", () => {
    const annotation = buildAttachmentAnnotation([
      { filename: "a.pdf", extractedText: "x" },
      { filename: "b.docx", extractedText: "y" },
    ]);
    expect(annotation).toContain("[Attached: a.pdf, b.docx]");
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

  it("threads the runtime-resolved budget into the use case", async () => {
    const budget = { contextBudgetChars: 400_000, fieldBatchSize: 8, maxPromptTokens: 150_000 };
    const execute = vi.fn().mockResolvedValue({
      data: { document: { filename: "f", storagePath: "p", summary: null, generatedAt: "now" } },
      error: null,
    });

    const container = {
      useCases: { generateDocument: { execute } },
      runtimeConfig: { resolveDocumentGenerationBudget: vi.fn().mockResolvedValue(budget) },
      repos: { sessionMessages: { updateDocumentStatus: vi.fn() } },
      services: { errorLogger: { log: vi.fn() } },
    } as unknown as Parameters<typeof generateDocument>[0];

    await generateDocument(
      container,
      "msg-budget",
      "sess-1",
      makeFlow(),
      [],
      [],
      makeNode({ config: { outputType: "generate_document", documentTemplatePath: "x" } as unknown as FlowNode["config"] }),
    );

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ budget }));
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

describe("applyAdvanceSideEffects", () => {
  const makeSession = (): Session =>
    ({
      id: "sess-1",
      flowId: "flow-1",
      userId: "user-1",
      status: "active",
      title: null,
      currentNodeId: "node-2",
      awaitingConfirmationNodeId: null,
      graphCheckpoint: null,
      pendingExecutions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Session);

  const completedDocNode = makeNode({
    id: "node-1",
    name: "Gather details",
    config: {
      outputType: "generate_document",
      documentTemplatePath: "tpl.docx",
    } as unknown as FlowNode["config"],
  });

  const model = new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1 },
      text: JSON.stringify({ response: "Hi", rationale: "r", stepCompleteConfidence: 0, contextGathered: [] }),
    }),
  });

  const baseInput = (overrides: Record<string, unknown>) => ({
    container: overrides.container,
    session: makeSession(),
    flow: makeFlow(),
    nodes: overrides.nodes as FlowNode[],
    completedNode: completedDocNode,
    newNodeId: (overrides.newNodeId as string | null) ?? null,
    fallbackMessages: [],
    gatheredContext: "",
    organisationName: null,
    userProfile: null,
    userId: "user-1",
    isAdmin: false,
    model,
    provider: "anthropic",
  }) as unknown as Parameters<typeof applyAdvanceSideEffects>[0];

  it("generates a document for the completed doc-node when a template is present", async () => {
    const updateDocumentStatus = vi.fn().mockResolvedValue({ data: {}, error: null });
    const generateDocumentExecute = vi.fn().mockResolvedValue({ data: { document: {} }, error: null });
    const listBySession = vi.fn().mockResolvedValue({
      data: [makeAssistantMessage({ id: "milestone", stepNodeId: "node-1" })],
      error: null,
    });

    const container = {
      repos: {
        sessionMessages: { listBySession, updateDocumentStatus },
        usageRepo: {},
      },
      useCases: { generateDocument: { execute: generateDocumentExecute } },
      services: { errorLogger: { log: vi.fn().mockResolvedValue({ error: null }) } },
    };

    await applyAdvanceSideEffects(baseInput({ container, nodes: [completedDocNode], newNodeId: null }));

    expect(updateDocumentStatus).toHaveBeenCalledWith("milestone", "pending");
    expect(generateDocumentExecute).toHaveBeenCalledTimes(1);
  });

  it("threads precomputed field values and grade from the gate into generation", async () => {
    const updateDocumentStatus = vi.fn().mockResolvedValue({ data: {}, error: null });
    const generateDocumentExecute = vi.fn().mockResolvedValue({ data: { document: {} }, error: null });
    const listBySession = vi.fn().mockResolvedValue({
      data: [makeAssistantMessage({ id: "milestone", stepNodeId: "node-1" })],
      error: null,
    });

    const container = {
      repos: { sessionMessages: { listBySession, updateDocumentStatus }, usageRepo: {} },
      runtimeConfig: { resolveDocumentGenerationBudget: vi.fn().mockResolvedValue(undefined) },
      useCases: { generateDocument: { execute: generateDocumentExecute } },
      services: { errorLogger: { log: vi.fn().mockResolvedValue({ error: null }) } },
    };

    const grade = {
      guidanceAlignmentConfidence: 91,
      guidanceAlignmentRationale: "g",
      criteriaAlignmentConfidence: 93,
      criteriaAlignmentRationale: "c",
    };
    const fieldValues = { project_title: "Reused" };

    await applyAdvanceSideEffects({
      ...baseInput({ container, nodes: [completedDocNode], newNodeId: null }),
      precomputedDocument: { fieldValues, grade },
    });

    expect(generateDocumentExecute).toHaveBeenCalledWith(
      expect.objectContaining({ fieldValues, grade }),
    );
  });

  it("skips the AI opener for an approval new node", async () => {
    const retrieveExecute = vi.fn().mockResolvedValue({ data: [], error: null });
    const listBySession = vi.fn().mockResolvedValue({ data: [], error: null });
    const approvalNode = makeNode({ id: "node-2", config: {} as unknown as FlowNode["config"] });
    (approvalNode as { type: string }).type = "approval";

    const container = {
      repos: { sessionMessages: { listBySession, updateDocumentStatus: vi.fn() }, usageRepo: {} },
      useCases: {
        generateDocument: { execute: vi.fn() },
        retrieveDocumentChunks: { execute: retrieveExecute },
        isFeatureEnabledForUser: { execute: vi.fn().mockResolvedValue({ data: false, error: null }) },
      },
      services: { errorLogger: { log: vi.fn() }, sessionAgent: { buildSystemPrompt: vi.fn() } },
    };

    await applyAdvanceSideEffects(
      baseInput({ container, nodes: [completedDocNode, approvalNode], newNodeId: "node-2" }),
    );

    // The approval gate raises its own request; no opener turn should run.
    expect(retrieveExecute).not.toHaveBeenCalled();
  });

  it("generates an AI opener for a conversational new node", async () => {
    const retrieveExecute = vi.fn().mockResolvedValue({ data: [], error: null });
    const listBySession = vi.fn().mockResolvedValue({ data: [], error: null });
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const conversationalNode = makeNode({
      id: "node-2",
      config: { aiInstruction: "Help", doneWhen: "done", outputType: "conversation_only" } as unknown as FlowNode["config"],
    });

    const container = {
      repos: {
        sessionMessages: { listBySession, updateDocumentStatus: vi.fn(), create },
        sessionUploads: { listBySession: vi.fn().mockResolvedValue({ data: [], error: null }) },
        usageRepo: {},
      },
      runtimeConfig: {
        getSessionUploadConfig: vi.fn().mockResolvedValue({ maxFileSizeBytes: 1, totalBudgetChars: 1000 }),
      },
      useCases: {
        generateDocument: { execute: vi.fn() },
        retrieveDocumentChunks: { execute: retrieveExecute },
        isFeatureEnabledForUser: { execute: vi.fn().mockResolvedValue({ data: false, error: null }) },
        resolveStepSkills: { execute: vi.fn().mockResolvedValue({ data: [], error: null }) },
      },
      services: {
        errorLogger: { log: vi.fn() },
        sessionAgent: { buildSystemPrompt: vi.fn().mockReturnValue({ data: "prompt", error: null }) },
      },
    };

    await applyAdvanceSideEffects(
      baseInput({ container, nodes: [completedDocNode, conversationalNode], newNodeId: "node-2" }),
    );

    expect(retrieveExecute).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });
});

describe("appendShortcomingsToContext", () => {
  it("appends the outstanding gaps to the message's gathered context, labelled", async () => {
    const findById = vi.fn().mockResolvedValue({
      data: makeAssistantMessage({
        id: "msg-1",
        aiPayload: {
          response: "ok",
          rationale: "r",
          stepCompleteConfidence: 92,
          contextGathered: [{ key: "Project name", value: "Cloud migration" }],
        },
      }),
      error: null,
    });
    const updateAiPayload = vi.fn().mockResolvedValue({ data: {}, error: null });

    const container = {
      repos: { sessionMessages: { findById, updateAiPayload } },
    } as unknown as Parameters<typeof appendShortcomingsToContext>[0];

    await appendShortcomingsToContext(container, "msg-1", ["The end date is missing."]);

    const payload = updateAiPayload.mock.calls[0]![1] as AiTurnPayload;
    expect(payload.contextGathered).toContainEqual({ key: "Project name", value: "Cloud migration" });
    expect(payload.contextGathered).toContainEqual({
      key: OUTSTANDING_CONTEXT_KEY,
      value: "The end date is missing.",
    });
  });

  it("does nothing when there are no gaps", async () => {
    const updateAiPayload = vi.fn();
    const container = {
      repos: { sessionMessages: { findById: vi.fn(), updateAiPayload } },
    } as unknown as Parameters<typeof appendShortcomingsToContext>[0];

    await appendShortcomingsToContext(container, "msg-1", []);

    expect(updateAiPayload).not.toHaveBeenCalled();
  });

  it("does nothing when the message has no aiPayload", async () => {
    const findById = vi.fn().mockResolvedValue({ data: makeAssistantMessage({ aiPayload: null }), error: null });
    const updateAiPayload = vi.fn();
    const container = {
      repos: { sessionMessages: { findById, updateAiPayload } },
    } as unknown as Parameters<typeof appendShortcomingsToContext>[0];

    await appendShortcomingsToContext(container, "msg-1", ["x"]);

    expect(updateAiPayload).not.toHaveBeenCalled();
  });
});

describe("streamGapFollowup", () => {
  const gapModel = () =>
    new MockLanguageModelV1({
      defaultObjectGenerationMode: "tool",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call-delta",
              toolCallType: "function",
              toolCallId: "c1",
              toolName: "json",
              argsTextDelta:
                '{"response":"Could you share the end date?","rationale":"gap","stepCompleteConfidence":20,"contextGathered":[]}',
            },
            { type: "finish", finishReason: "stop", usage: { promptTokens: 2, completionTokens: 4 } },
          ],
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    });

  const session = (): Session =>
    ({ id: "sess-1", currentNodeId: "node-1" } as unknown as Session);

  it("streams a follow-up asking for the gaps and persists it on the same node", async () => {
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const written: string[] = [];

    const container = {
      repos: {
        sessionMessages: { create },
        usageRepo: { create: vi.fn().mockResolvedValue({ data: {}, error: null }) },
      },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    await streamGapFollowup({
      container,
      writer: { write: (s: string) => written.push(s) },
      session: session(),
      flowId: "flow-1",
      system: "base system prompt",
      messages: [{ role: "user", content: "All done" }],
      missingInformation: ["The end date is missing."],
      model: gapModel(),
      modelName: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      userId: "user-1",
    });

    expect(written.join("")).toContain("Could you share the end date?");
    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0]![0];
    expect(createArg.role).toBe("assistant");
    expect(createArg.stepNodeId).toBe("node-1");
    expect(createArg.content).toContain("end date");
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
