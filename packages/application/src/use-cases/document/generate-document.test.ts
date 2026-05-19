import { describe, it, expect, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  IDocumentGenerator,
  IDocumentStorage,
  ILanguageModel,
  ISessionMessageRepository,
  SessionMessage,
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
    documentTemplatePath: "/data/templates/node-1/rft-template.docx",
    documentTemplateFilename: "rft-template.docx",
    ...configOverrides,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeDocumentGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: ["project_title", "background"] })),
  generate: vi.fn().mockReturnValue(ok({ docxBytes: Buffer.from("fake-docx") })),
});

const makeDocumentStorage = (): IDocumentStorage => ({
  readBytes: vi.fn().mockResolvedValue(ok(Buffer.from("template-bytes"))),
  writeBytes: vi.fn().mockResolvedValue(ok(undefined)),
  exists: vi.fn().mockResolvedValue(ok(true)),
});

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(
    ok({
      object: { project_title: "Cloud Migration RFT", background: "Agency background" },
      usage: { promptTokens: 100, completionTokens: 50, systemTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
    }),
  ),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeSessionMessages = (): ISessionMessageRepository => ({
  create: vi.fn().mockResolvedValue(ok(makeMessage())),
  findById: vi.fn().mockResolvedValue(ok(makeMessage())),
  listBySession: vi.fn().mockResolvedValue(ok([makeMessage({ role: "user", content: "I need an RFT for cloud migration" }), makeMessage()])),
  updateDocument: vi.fn().mockResolvedValue(ok(makeMessage({ document: { filename: "Procurement-Flow-Generate-RFT-sess1abc-2026-05-19.docx", storagePath: "/data/generated/sess-1/doc.docx", summary: "A brief summary.", generatedAt: "2026-05-19T00:00:00.000Z" } }))),
});

describe("GenerateDocument", () => {
  it("generates a document and updates the message with document metadata", async () => {
    const documentGenerator = makeDocumentGenerator();
    const documentStorage = makeDocumentStorage();
    const languageModel = makeLanguageModel();
    const sessionMessages = makeSessionMessages();

    const useCase = new GenerateDocument(documentGenerator, documentStorage, languageModel, sessionMessages);

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
    expect(documentStorage.writeBytes).toHaveBeenCalled();
    expect(sessionMessages.updateDocument).toHaveBeenCalledWith("msg-1", expect.objectContaining({ filename: expect.stringMatching(/\.docx$/) }));
  });

  it("returns an error when node has no template configured", async () => {
    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeDocumentStorage(),
      makeLanguageModel(),
      makeSessionMessages(),
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
    const documentStorage = makeDocumentStorage();
    (documentStorage.readBytes as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("NOT_FOUND", "Template not found.")),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      documentStorage,
      makeLanguageModel(),
      makeSessionMessages(),
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
      makeDocumentStorage(),
      languageModel,
      makeSessionMessages(),
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
});
