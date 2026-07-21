import { describe, expect, it, vi } from "vitest";
import type { AiTurnPayload, Flow, FlowNode, SessionMessage, SessionUpload } from "@rbrasier/domain";
import {
  appendShortcomingsToContext,
  applyAdvanceSideEffects,
  buildAttachmentAnnotation,
  buildGatheredContext,
  buildPromptSessionUploads,
  CROSS_CHECK_PASS_NOTE,
  generateDocument,
  generateInitialMessage,
  generateTitle,
  maybeUpdateSessionTitle,
  OUTSTANDING_CONTEXT_KEY,
  persistCrossCheckPassNote,
  persistHeldReply,
  streamGapFollowup,
  writeCrossCheckPassNote,
} from "./turn-helpers";
import type { Session, TurnStreamWriter } from "@rbrasier/domain";

// A TurnStreamWriter that records the ordered sequence of semantic operations
// ("boundary" for endBubble, "text:<t>" for writeText) plus the text payloads,
// so a test can assert both the bubble boundaries and the streamed content.
const recordingWriter = (): TurnStreamWriter & { ops: string[]; texts: string[] } => {
  const ops: string[] = [];
  const texts: string[] = [];
  return {
    ops,
    texts,
    writeText: (text: string) => {
      ops.push(`text:${text}`);
      texts.push(text);
    },
    endBubble: () => {
      ops.push("boundary");
    },
    writeAnnotation: () => {},
  };
};

const noopWriter = (): TurnStreamWriter => ({
  writeText: () => {},
  endBubble: () => {},
  writeAnnotation: () => {},
});

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

    const llm = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue({
        data: {
          object: {
            response: "Hello",
            rationale: "r",
            stepCompleteConfidence: 0,
            contextGathered: [],
          },
          usage: {
            promptTokens: 1,
            completionTokens: 1,
            systemTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
        },
      }),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    };

    const retrieveDocumentChunks = {
      execute: vi.fn().mockResolvedValue({ data: [], error: null }),
    };

    const container = {
      services: {
        llm,
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
      modelName: "claude-haiku-4-5-20251001",
      organisationName: "Acme",
      userProfile: { name: "Ada Lovelace", role: "Analyst", team: "Risk" },
      userId: "user-1",
      gatheredContext: "- Full Name: John Dutton\n- Department: Sales",
      globalInstructions: "Use Australian English spelling.",
    });

    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    const call = buildSystemPrompt.mock.calls[0]![0];
    expect(call.gatheredContext).toContain("John Dutton");
    expect(call.gatheredContext).toContain("Sales");
    expect(call.globalInstructions).toBe("Use Australian English spelling.");

    expect(llm.generateObject).toHaveBeenCalledTimes(1);
    const portCall = llm.generateObject.mock.calls[0]![0];
    expect(portCall.purpose).toBe("chat-turn");
    expect(portCall.model).toBe("claude-haiku-4-5-20251001");
    expect(portCall.userId).toBe("user-1");
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
    modelName: "claude-haiku-4-5-20251001",
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
        resolveStepSkills: { execute: vi.fn().mockResolvedValue({ data: [], error: null }) },
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

    const llm = {
      provider: "anthropic",
      generateObject: vi.fn().mockResolvedValue({
        data: {
          object: { response: "Hi", rationale: "r", stepCompleteConfidence: 0, contextGathered: [] },
          usage: { promptTokens: 1, completionTokens: 1, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        },
      }),
      streamText: vi.fn(),
      streamObject: vi.fn(),
    };

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
        llm,
        errorLogger: { log: vi.fn() },
        sessionAgent: { buildSystemPrompt: vi.fn().mockReturnValue({ data: "prompt", error: null }) },
      },
    };

    await applyAdvanceSideEffects(
      baseInput({ container, nodes: [completedDocNode, conversationalNode], newNodeId: "node-2" }),
    );

    expect(retrieveExecute).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
    expect(llm.generateObject).toHaveBeenCalled();
  });

  it("awaits document generation before opening the next step", async () => {
    // Regression guard (bug 1): the next-step opener must not run until the
    // document has finished generating. Generation is held open on a deferred
    // promise; the opener's retrieval must not fire until it resolves.
    let resolveDocGen: ((value: { data: { document: object }; error: null }) => void) | null = null;
    const generateDocumentExecute = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDocGen = resolve;
        }),
    );
    const retrieveExecute = vi.fn().mockResolvedValue({ data: [], error: null });
    const listBySession = vi.fn().mockResolvedValue({
      data: [makeAssistantMessage({ id: "milestone", stepNodeId: "node-1" })],
      error: null,
    });
    const conversationalNode = makeNode({
      id: "node-2",
      config: { aiInstruction: "Help", doneWhen: "done", outputType: "conversation_only" } as unknown as FlowNode["config"],
    });

    const container = {
      repos: {
        sessionMessages: {
          listBySession,
          updateDocumentStatus: vi.fn().mockResolvedValue({ data: {}, error: null }),
          create: vi.fn().mockResolvedValue({ data: {}, error: null }),
        },
        sessionUploads: { listBySession: vi.fn().mockResolvedValue({ data: [], error: null }) },
        usageRepo: {},
      },
      runtimeConfig: {
        resolveDocumentGenerationBudget: vi.fn().mockResolvedValue(undefined),
        getSessionUploadConfig: vi.fn().mockResolvedValue({ maxFileSizeBytes: 1, totalBudgetChars: 1000 }),
      },
      useCases: {
        generateDocument: { execute: generateDocumentExecute },
        retrieveDocumentChunks: { execute: retrieveExecute },
        isFeatureEnabledForUser: { execute: vi.fn().mockResolvedValue({ data: false, error: null }) },
      },
      services: {
        errorLogger: { log: vi.fn().mockResolvedValue({ error: null }) },
        sessionAgent: { buildSystemPrompt: vi.fn().mockReturnValue({ data: "prompt", error: null }) },
      },
    };

    const pending = applyAdvanceSideEffects(
      baseInput({ container, nodes: [completedDocNode, conversationalNode], newNodeId: "node-2" }),
    );

    // Let the microtask queue drain up to the awaited generation (several awaits
    // precede it: the message list, the pending-status write, the budget resolve).
    for (let tick = 0; tick < 20; tick += 1) await Promise.resolve();
    expect(generateDocumentExecute).toHaveBeenCalledTimes(1);
    expect(retrieveExecute).not.toHaveBeenCalled();

    resolveDocGen!({ data: { document: {} }, error: null });
    await pending;

    // Only once generation resolves does the opener run.
    expect(retrieveExecute).toHaveBeenCalled();
  });

  it("signals document-generation start and end around the awaited generation", async () => {
    const signals: boolean[] = [];
    const generateDocumentExecute = vi.fn().mockResolvedValue({ data: { document: {} }, error: null });
    const listBySession = vi.fn().mockResolvedValue({
      data: [makeAssistantMessage({ id: "milestone", stepNodeId: "node-1" })],
      error: null,
    });

    const container = {
      repos: {
        sessionMessages: { listBySession, updateDocumentStatus: vi.fn().mockResolvedValue({ data: {}, error: null }) },
        usageRepo: {},
      },
      runtimeConfig: { resolveDocumentGenerationBudget: vi.fn().mockResolvedValue(undefined) },
      useCases: { generateDocument: { execute: generateDocumentExecute } },
      services: { errorLogger: { log: vi.fn().mockResolvedValue({ error: null }) } },
    };

    await applyAdvanceSideEffects({
      ...baseInput({ container, nodes: [completedDocNode], newNodeId: null }),
      onDocumentGenerationChange: (active: boolean) => signals.push(active),
    });

    expect(signals).toEqual([true, false]);
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
  const fakeGapLlm = (
    finalResponse: string,
  ): {
    llm: Parameters<typeof streamGapFollowup>[0]["container"]["services"]["llm"];
    streamObject: ReturnType<typeof vi.fn>;
  } => {
    const streamObject = vi.fn(async () => {
      async function* stream() {
        yield { response: finalResponse };
      }
      return {
        data: {
          partialObjectStream: stream(),
          object: Promise.resolve({
            response: finalResponse,
            rationale: "gap",
            stepCompleteConfidence: 20,
            contextGathered: [],
          }),
          usage: Promise.resolve({
            promptTokens: 2,
            completionTokens: 4,
            systemTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          }),
        },
      };
    });
    return {
      llm: {
        provider: "anthropic",
        generateObject: vi.fn(),
        streamText: vi.fn(),
        streamObject,
      } as unknown as Parameters<typeof streamGapFollowup>[0]["container"]["services"]["llm"],
      streamObject,
    };
  };

  const session = (): Session =>
    ({ id: "sess-1", currentNodeId: "node-1" } as unknown as Session);

  it("streams a follow-up asking for the gaps and persists it on the same node", async () => {
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { llm } = fakeGapLlm("Could you share the end date?");

    const container = {
      services: { llm },
      repos: {
        sessionMessages: { create },
        usageRepo: {},
      },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    const writer = recordingWriter();
    await streamGapFollowup({
      container,
      writer,
      session: session(),
      flowId: "flow-1",
      system: "base system prompt",
      messages: [{ role: "user", content: "All done" }],
      missingInformation: ["The end date is missing."],
      modelName: "claude-haiku-4-5-20251001",
      userId: "user-1",
    });

    // The follow-up must open a NEW bubble: an endBubble boundary precedes its
    // text so the client never appends it onto the reply it corrects.
    expect(writer.ops[0]).toBe("boundary");
    expect(writer.texts.join("")).toContain("Could you share the end date?");
    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0]![0];
    expect(createArg.role).toBe("assistant");
    expect(createArg.stepNodeId).toBe("node-1");
    expect(createArg.content).toContain("end date");
  });

  it("returns the persisted follow-up message id so the caller can record the hold", async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: "followup-1" }, error: null });
    const { llm } = fakeGapLlm("gap prompt");

    const container = {
      services: { llm },
      repos: { sessionMessages: { create }, usageRepo: {} },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    const result = await streamGapFollowup({
      container,
      writer: noopWriter(),
      session: session(),
      flowId: "flow-1",
      system: "base system prompt",
      messages: [{ role: "user", content: "All done" }],
      missingInformation: ["The end date is missing."],
      modelName: "claude-haiku-4-5-20251001",
      userId: "user-1",
    });

    expect(result.messageId).toBe("followup-1");
  });

  it("returns a null message id when persistence fails so no hold is recorded", async () => {
    const create = vi.fn().mockResolvedValue({ data: null, error: { code: "DB", message: "boom" } });
    const { llm } = fakeGapLlm("gap prompt");

    const container = {
      services: { llm },
      repos: { sessionMessages: { create }, usageRepo: {} },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    const result = await streamGapFollowup({
      container,
      writer: noopWriter(),
      session: session(),
      flowId: "flow-1",
      system: "base system prompt",
      messages: [{ role: "user", content: "All done" }],
      missingInformation: ["The end date is missing."],
      modelName: "claude-haiku-4-5-20251001",
      userId: "user-1",
    });

    expect(result.messageId).toBeNull();
  });

  it("falls back to a generic gap description when the grading model reported no specific items", async () => {
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { llm, streamObject } = fakeGapLlm("Could you confirm a few more details?");

    const container = {
      services: { llm },
      repos: { sessionMessages: { create }, usageRepo: {} },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    await streamGapFollowup({
      container,
      writer: noopWriter(),
      session: session(),
      flowId: "flow-1",
      system: "base system prompt",
      messages: [{ role: "user", content: "All done" }],
      missingInformation: [],
      modelName: "claude-haiku-4-5-20251001",
      userId: "user-1",
    });

    const passed = streamObject.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const systemMessage = passed.messages.find((m) => m.role === "system");
    expect(systemMessage?.content).toContain("still need to be confirmed");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("routes through the ILanguageModel port with purpose=chat-gap-followup", async () => {
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { llm, streamObject } = fakeGapLlm("Please confirm.");

    const container = {
      services: { llm },
      repos: { sessionMessages: { create }, usageRepo: {} },
    } as unknown as Parameters<typeof streamGapFollowup>[0]["container"];

    await streamGapFollowup({
      container,
      writer: noopWriter(),
      session: session(),
      flowId: "flow-1",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      missingInformation: ["x"],
      modelName: "claude-haiku-4-5-20251001",
      userId: "user-1",
    });

    const passed = streamObject.mock.calls[0]![0] as {
      purpose: string;
      userId: string;
      flowId: string;
      sessionId: string;
      model: string;
    };
    expect(passed.purpose).toBe("chat-gap-followup");
    expect(passed.userId).toBe("user-1");
    expect(passed.flowId).toBe("flow-1");
    expect(passed.sessionId).toBe("sess-1");
    expect(passed.model).toBe("claude-haiku-4-5-20251001");
  });
});

describe("persistHeldReply", () => {
  const heldPayload: AiTurnPayload = {
    response: "All set — ready to submit.",
    rationale: "r",
    stepCompleteConfidence: 94.4,
    contextGathered: [],
  };

  it("persists the overruled reply on the current node so the streamed bubble is never rewritten", async () => {
    const create = vi.fn().mockResolvedValue({ data: { id: "held-1" }, error: null });
    const container = {
      repos: { sessionMessages: { create } },
    } as unknown as Parameters<typeof persistHeldReply>[0];

    await persistHeldReply(
      container,
      { id: "sess-1", currentNodeId: "node-1" } as unknown as Session,
      heldPayload,
    );

    expect(create).toHaveBeenCalledWith({
      sessionId: "sess-1",
      role: "assistant",
      content: "All set — ready to submit.",
      confidence: 94,
      stepNodeId: "node-1",
      aiPayload: heldPayload,
    });
  });

  it("swallows persistence failures so the corrective follow-up still streams", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const container = {
      repos: { sessionMessages: { create } },
    } as unknown as Parameters<typeof persistHeldReply>[0];

    await expect(
      persistHeldReply(
        container,
        { id: "sess-1", currentNodeId: "node-1" } as unknown as Session,
        heldPayload,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("cross-check pass note", () => {
  it("streams the note behind a message boundary so it renders as a new bubble", () => {
    const writer = recordingWriter();

    writeCrossCheckPassNote(writer);

    // endBubble closes the current bubble; the note text then opens a fresh one.
    expect(writer.ops[0]).toBe("boundary");
    expect(writer.ops[1]).toMatch(/^text:/);
    expect(writer.texts[0]).toContain("alignment");
  });

  it("persists the note as a system message on the completed node", async () => {
    const create = vi.fn().mockResolvedValue({ data: {}, error: null });
    const container = {
      repos: { sessionMessages: { create } },
    } as unknown as Parameters<typeof persistCrossCheckPassNote>[0];

    await persistCrossCheckPassNote(container, "sess-1", "node-1");

    expect(create).toHaveBeenCalledWith({
      sessionId: "sess-1",
      role: "system",
      content: CROSS_CHECK_PASS_NOTE,
      stepNodeId: "node-1",
    });
  });

  it("swallows persistence failures so the advance still proceeds", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const container = {
      repos: { sessionMessages: { create } },
    } as unknown as Parameters<typeof persistCrossCheckPassNote>[0];

    await expect(persistCrossCheckPassNote(container, "sess-1", "node-1")).resolves.toBeUndefined();
  });
});

describe("generateTitle", () => {
  it("routes through the ILanguageModel port and persists the generated title", async () => {
    const generateText = vi.fn().mockResolvedValue({
      data: { text: "  Onboarding Alex  ", usage: {} },
      error: null,
    });
    const update = vi.fn().mockResolvedValue({ data: {}, error: null });
    const container = {
      services: { llm: { generateText } },
      repos: { sessions: { update } },
    } as unknown as Parameters<typeof generateTitle>[0];

    await generateTitle(container, "sess-1", "Help me onboard Alex", "haiku", "user-1");

    // The port call carries the purpose/session so usage records and quota apply.
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "chat-title", sessionId: "sess-1", model: "haiku", userId: "user-1" }),
    );
    expect(update).toHaveBeenCalledWith("sess-1", { title: "Onboarding Alex" });
  });

  it("falls back to a truncated message when the port errors (e.g. quota block)", async () => {
    const generateText = vi.fn().mockResolvedValue({
      data: undefined,
      error: { code: "QUOTA_EXCEEDED", message: "capped" },
    });
    const update = vi.fn().mockResolvedValue({ data: {}, error: null });
    const container = {
      services: { llm: { generateText } },
      repos: { sessions: { update } },
    } as unknown as Parameters<typeof generateTitle>[0];

    await generateTitle(container, "sess-1", "A long first message that should be truncated", "haiku", "user-1");

    expect(update).toHaveBeenCalledWith("sess-1", {
      title: "A long first message that should be truncated",
    });
  });
});

describe("maybeUpdateSessionTitle", () => {
  const buildContainer = (generatedText = "Generated Title") => {
    const generateText = vi.fn().mockResolvedValue({ data: { text: generatedText, usage: {} }, error: null });
    const update = vi.fn().mockResolvedValue({ data: {}, error: null });
    const container = {
      services: { llm: { generateText } },
      repos: { sessions: { update } },
    } as unknown as Parameters<typeof maybeUpdateSessionTitle>[0];
    return { container, generateText, update };
  };

  it("sets the '{Flow} (new)' placeholder on the kickoff turn (0 prior user messages)", async () => {
    const { container, generateText, update } = buildContainer();
    await maybeUpdateSessionTitle(container, { id: "s1", title: null }, "Onboarding", 0, "kickoff", "haiku", "u1");
    expect(update).toHaveBeenCalledWith("s1", { title: "Onboarding (new)" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("generates a real title on the first real user message (1 prior user message)", async () => {
    const { container, generateText } = buildContainer("Real Title");
    await maybeUpdateSessionTitle(
      container,
      { id: "s1", title: "Onboarding (new)" },
      "Onboarding",
      1,
      "Please onboard Alex",
      "haiku",
      "u1",
    );
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ purpose: "chat-title", sessionId: "s1" }));
  });

  it("leaves a manually renamed chat alone on the second message", async () => {
    const { container, generateText, update } = buildContainer();
    await maybeUpdateSessionTitle(
      container,
      { id: "s1", title: "My custom name" },
      "Onboarding",
      1,
      "second message",
      "haiku",
      "u1",
    );
    expect(generateText).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing on later turns (2+ prior user messages)", async () => {
    const { container, generateText, update } = buildContainer();
    await maybeUpdateSessionTitle(container, { id: "s1", title: "Set" }, "Onboarding", 2, "third", "haiku", "u1");
    expect(generateText).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
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
