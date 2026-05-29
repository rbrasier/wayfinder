import { describe, it, expect, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  IDocumentGenerator,
  IObjectStorage,
  ILanguageModel,
  ISessionMessageRepository,
  ISessionStepOutputRepository,
  SessionMessage,
  SessionStepOutput,
  FlowNode,
  Flow,
} from "@rbrasier/domain";
import { GenerateDocument } from "./generate-document";

const makeMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  id: "msg-1",
  sessionId: "sess-1",
  role: "assistant",
  content: "Step complete",
  confidence: 95,
  stepNodeId: "node-1",
  document: null,
  createdAt: new Date(),
  ...overrides,
});

const makeFlow = (): Flow => ({
  id: "flow-1",
  name: "Procurement Flow",
  description: null,
  icon: null,
  ownerUserId: "user-1",
  status: "published",
  permissions: [],
  contextDocs: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeNode = (configOverrides: Record<string, unknown> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Generate RFT",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {
    aiInstruction: "Generate an RFT document",
    doneWhen: "All information gathered",
    outputType: "generate_document",
    documentTemplatePath: "templates/node-1/rft-template.docx",
    documentTemplateFilename: "rft-template.docx",
    ...configOverrides,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeDocumentGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: ["project_title", "background"] })),
  extractFields: vi.fn().mockReturnValue(
    ok({
      fields: [
        { key: "project_title", label: "Project Title", type: "text", optional: false, raw: "Project Title" },
        { key: "background", label: "Background", type: "text", optional: false, raw: "Background" },
      ],
    }),
  ),
  extractFullText: vi.fn().mockReturnValue(ok({ text: "template text" })),
  generate: vi.fn().mockReturnValue(ok({ docxBytes: Buffer.from("fake-docx") })),
});

const makeStepOutputs = (): ISessionStepOutputRepository => ({
  create: vi.fn().mockImplementation(
    async (input): Promise<{ data: SessionStepOutput }> => ({
      data: {
        id: "step-1",
        sessionId: input.sessionId,
        flowId: input.flowId,
        nodeId: input.nodeId,
        messageId: input.messageId ?? null,
        fields: input.fields,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  ),
  listByFlow: vi.fn().mockResolvedValue(ok([])),
});

const makeObjectStorage = (): IObjectStorage => ({
  put: vi.fn().mockResolvedValue(ok({ key: "generated/sess-1/doc.docx" })),
  get: vi.fn().mockResolvedValue(ok(Buffer.from("template-bytes"))),
  delete: vi.fn().mockResolvedValue(ok(undefined)),
  exists: vi.fn().mockResolvedValue(ok(true)),
  initialise: vi.fn().mockResolvedValue(undefined),
});

const usage = { promptTokens: 100, completionTokens: 50, systemTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockImplementation(async (input: { purpose: string }) => {
    if (input.purpose === "documentGeneration") {
      return ok({
        object: { project_title: "Cloud Migration RFT", background: "Agency background" },
        usage,
      });
    }
    if (input.purpose === "documentGrading") {
      return ok({
        object: {
          guidanceAlignmentConfidence: 88,
          guidanceAlignmentRationale: "Document references the CPR guidance closely.",
          criteriaAlignmentConfidence: 92,
          criteriaAlignmentRationale: "All required fields are populated from the transcript.",
        },
        usage,
      });
    }
    return ok({ object: { summary: "A brief summary." }, usage });
  }),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeSessionMessages = (): ISessionMessageRepository => ({
  create: vi.fn().mockResolvedValue(ok(makeMessage())),
  findById: vi.fn().mockResolvedValue(ok(makeMessage())),
  listBySession: vi.fn().mockResolvedValue(ok([makeMessage({ role: "user", content: "I need an RFT for cloud migration" }), makeMessage()])),
  updateDocument: vi.fn().mockResolvedValue(ok(makeMessage({ document: { filename: "Procurement-Flow-Generate-RFT-sess1abc-2026-05-19.docx", storagePath: "generated/sess-1/doc.docx", summary: "A brief summary.", generatedAt: "2026-05-19T00:00:00.000Z" } }))),
  updateDocumentStatus: vi.fn().mockResolvedValue(ok(makeMessage())),
  updateAiPayload: vi.fn().mockResolvedValue(ok(makeMessage())),
});

describe("GenerateDocument", () => {
  it("generates a document and updates the message with document metadata", async () => {
    const documentGenerator = makeDocumentGenerator();
    const objectStorage = makeObjectStorage();
    const languageModel = makeLanguageModel();
    const sessionMessages = makeSessionMessages();

    const useCase = new GenerateDocument(documentGenerator, objectStorage, languageModel, sessionMessages, makeStepOutputs());

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage({ role: "user", content: "I need an RFT" }), makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document.filename).toMatch(/\.docx$/);
    expect(result.data?.document.storagePath).toContain("sess-1");
    expect(objectStorage.put).toHaveBeenCalled();
    expect(sessionMessages.updateDocument).toHaveBeenCalledWith("msg-1", expect.objectContaining({ filename: expect.stringMatching(/\.docx$/) }));
  });

  it("persists the generated field values as a step output for reporting", async () => {
    const stepOutputs = makeStepOutputs();

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      makeLanguageModel(),
      makeSessionMessages(),
      stepOutputs,
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeUndefined();
    expect(stepOutputs.create).toHaveBeenCalledWith({
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-1",
      messageId: "msg-1",
      fields: [
        { key: "project_title", label: "Project Title", type: "text", value: "Cloud Migration RFT" },
        { key: "background", label: "Background", type: "text", value: "Agency background" },
      ],
    });
  });

  it("returns an error when node has no template configured", async () => {
    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      makeLanguageModel(),
      makeSessionMessages(),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [],
      flow: makeFlow(),
      node: makeNode({ documentTemplatePath: undefined }),
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("returns an error when template bytes cannot be read", async () => {
    const objectStorage = makeObjectStorage();
    (objectStorage.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("NOT_FOUND", "Template not found.")),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      objectStorage,
      makeLanguageModel(),
      makeSessionMessages(),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeDefined();
  });

  it("returns an error when the AI fails to return valid JSON", async () => {
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "AI model failed.")),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeDefined();
  });

  it("grades the generated document and merges confidence into the message aiPayload", async () => {
    const sessionMessages = makeSessionMessages();
    const existingPayload = {
      response: "Step complete",
      rationale: "All inputs gathered.",
      stepCompleteConfidence: 95,
      contextGathered: [{ key: "Project name", value: "Cloud migration" }],
    };
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(makeMessage({ aiPayload: existingPayload })),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      makeLanguageModel(),
      sessionMessages,
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeUndefined();
    expect(sessionMessages.updateAiPayload).toHaveBeenCalledWith("msg-1", {
      ...existingPayload,
      documentGenerationConfidence: {
        guidanceAlignmentConfidence: 88,
        guidanceAlignmentRationale: "Document references the CPR guidance closely.",
        criteriaAlignmentConfidence: 92,
        criteriaAlignmentRationale: "All required fields are populated from the transcript.",
      },
    });
  });

  it("returns the document even when the grader LLM call fails, and does not write a payload", async () => {
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockImplementation(async (input: { purpose: string }) => {
      if (input.purpose === "documentGrading") {
        return err(domainError("INFRA_FAILURE", "Grader call failed."));
      }
      if (input.purpose === "documentGeneration") {
        return ok({
          object: { project_title: "Cloud Migration RFT", background: "Agency background" },
          usage,
        });
      }
      return ok({ object: { summary: "A brief summary." }, usage });
    });
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(makeMessage({ aiPayload: { response: "", rationale: "", stepCompleteConfidence: 95, contextGathered: [] } })),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      languageModel,
      sessionMessages,
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document.filename).toMatch(/\.docx$/);
    expect(sessionMessages.updateAiPayload).not.toHaveBeenCalled();
  });

  it("skips the payload write when the milestone message has no existing aiPayload", async () => {
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(makeMessage({ aiPayload: null })),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      makeLanguageModel(),
      sessionMessages,
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });

    expect(result.error).toBeUndefined();
    expect(sessionMessages.updateAiPayload).not.toHaveBeenCalled();
  });
});
