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
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("fake-docx") })),
  annotate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("annotated"), appliedCount: 0, unmatched: [] })),
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

  it("names the file .xlsx and stores it with the spreadsheet MIME type when the template format is xlsx", async () => {
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.generate as ReturnType<typeof vi.fn>).mockReturnValue(ok({ bytes: Buffer.from("fake-xlsx") }));
    const objectStorage = makeObjectStorage();
    const sessionMessages = makeSessionMessages();

    const useCase = new GenerateDocument(documentGenerator, objectStorage, makeLanguageModel(), sessionMessages, makeStepOutputs());

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode({ documentTemplateFormat: "xlsx", spreadsheetTemplateMode: "header" }),
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document.filename).toMatch(/\.xlsx$/);
    expect(objectStorage.put).toHaveBeenCalledWith(
      expect.stringMatching(/\.xlsx$/),
      expect.any(Buffer),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
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

  it("passes section gates to the renderer as booleans while persisting Yes/No for reporting", async () => {
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(
      ok({
        fields: [
          { key: "background", label: "Background", type: "narrative", optional: false, raw: "Background" },
          { key: "risk_section", label: "Risk Section", type: "section", optional: true, raw: "#Risk Section" },
        ],
      }),
    );
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockImplementation(async (input: { purpose: string }) => {
      if (input.purpose === "documentGeneration") {
        return ok({ object: { background: "Three paragraphs of context.", risk_section: "Yes" }, usage });
      }
      return ok({ object: { summary: "A brief summary." }, usage });
    });
    const stepOutputs = makeStepOutputs();

    const useCase = new GenerateDocument(
      documentGenerator,
      makeObjectStorage(),
      languageModel,
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
    const renderCall = (documentGenerator.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(renderCall.data.risk_section).toBe(true);
    expect(renderCall.data.background).toBe("Three paragraphs of context.");

    const persisted = (stepOutputs.create as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(persisted.fields).toContainEqual(
      expect.objectContaining({ key: "risk_section", type: "section", value: "Yes" }),
    );
  });

  it("generates large templates in batches rather than one model call", async () => {
    const manyFields = Array.from({ length: 14 }, (_, index) => ({
      key: `field_${index}`,
      label: `Field ${index}`,
      type: "text" as const,
      optional: false,
      raw: `Field ${index}`,
    }));
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(ok({ fields: manyFields }));

    const languageModel = makeLanguageModel();

    const useCase = new GenerateDocument(
      documentGenerator,
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
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
    // 14 fields over a batch size of 12 means two documentGeneration calls.
    const generationCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.purpose === "documentGeneration",
    );
    expect(generationCalls.length).toBe(2);
  });

  it("uses an injected fieldBatchSize from the resolved budget", async () => {
    const manyFields = Array.from({ length: 14 }, (_, index) => ({
      key: `field_${index}`,
      label: `Field ${index}`,
      type: "text" as const,
      optional: false,
      raw: `Field ${index}`,
    }));
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(ok({ fields: manyFields }));

    const languageModel = makeLanguageModel();

    const useCase = new GenerateDocument(
      documentGenerator,
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
      budget: { contextBudgetChars: 400_000, fieldBatchSize: 5, maxPromptTokens: 180_000 },
    });

    expect(result.error).toBeUndefined();
    // 14 fields over an injected batch size of 5 means three documentGeneration calls.
    const generationCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.purpose === "documentGeneration",
    );
    expect(generationCalls.length).toBe(3);
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

  it("reuses precomputed field values instead of re-running the extraction", async () => {
    const languageModel = makeLanguageModel();
    const documentGenerator = makeDocumentGenerator();

    const useCase = new GenerateDocument(
      documentGenerator,
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
      makeStepOutputs(),
    );

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
      fieldValues: { project_title: "Reused Title", background: "Reused Background" },
    });

    expect(result.error).toBeUndefined();
    const generationCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.purpose === "documentGeneration",
    );
    expect(generationCalls.length).toBe(0);
    const renderCall = (documentGenerator.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(renderCall.data.project_title).toBe("Reused Title");
  });

  it("persists a precomputed grade and does not run the internal grading call", async () => {
    const languageModel = makeLanguageModel();
    const sessionMessages = makeSessionMessages();
    const existingPayload = {
      response: "Step complete",
      rationale: "All inputs gathered.",
      stepCompleteConfidence: 95,
      contextGathered: [],
    };
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(makeMessage({ aiPayload: existingPayload })),
    );

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      languageModel,
      sessionMessages,
      makeStepOutputs(),
    );

    const precomputedGrade = {
      guidanceAlignmentConfidence: 81,
      guidanceAlignmentRationale: "Precomputed guidance rationale.",
      criteriaAlignmentConfidence: 84,
      criteriaAlignmentRationale: "Precomputed criteria rationale.",
    };

    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
      fieldValues: { project_title: "x", background: "y" },
      grade: precomputedGrade,
    });

    expect(result.error).toBeUndefined();
    const gradingCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[0]?.purpose === "documentGrading",
    );
    expect(gradingCalls.length).toBe(0);
    expect(sessionMessages.updateAiPayload).toHaveBeenCalledWith("msg-1", {
      ...existingPayload,
      documentGenerationConfidence: precomputedGrade,
    });
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

  // The reported defect: a second approver rejected the document, work routed
  // back to this step, and regenerating here reproduced exactly what had been
  // rejected — the approver's instruction never reached the extraction prompt.
  it("puts an outstanding change request into the extraction prompt", async () => {
    const languageModel = makeLanguageModel();

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
      messages: [makeMessage({ role: "user", content: "The start date is 01-03-2026" })],
      flow: makeFlow(),
      node: makeNode(),
      changeRequests: [
        {
          nodeId: "node-approval-2",
          stepName: "Finance sign-off",
          comment: "The start date must be 03-03-2026.",
        },
      ],
    });

    expect(result.error).toBeUndefined();
    const extraction = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .find((call) => call.purpose === "documentGeneration");
    expect(extraction.prompt).toContain("Finance sign-off: The start date must be 03-03-2026.");
  });

  // The gate already extracted the values on the advance path, so generation
  // reuses them; re-extracting here would spend a second model call to reach
  // the same answer the gate reached with the same change requests.
  it("skips extraction entirely when the gate threaded values through", async () => {
    const languageModel = makeLanguageModel();

    const useCase = new GenerateDocument(
      makeDocumentGenerator(),
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
      makeStepOutputs(),
    );

    await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
      fieldValues: { project_title: "Cloud Migration RFT", background: "Agency background" },
      changeRequests: [{ nodeId: "node-a", stepName: "Finance sign-off", comment: "Change it." }],
    });

    const extractionCalls = (languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .filter((call) => call.purpose === "documentGeneration");
    expect(extractionCalls).toHaveLength(0);
  });
});

describe("GenerateDocument — external-sourced fields", () => {
  const SNAPSHOT_VERSION = "v-2026-08-02";
  const FETCHED_AT = new Date("2026-08-02T09:00:00.000Z");

  const externalGenerator = (): IDocumentGenerator => {
    const generator = makeDocumentGenerator();
    (generator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(
      ok({
        fields: [
          {
            key: "department",
            label: "Department",
            type: "text",
            optionsSource: "departments",
            optional: false,
            raw: "Department (options-source: departments)",
          },
        ],
      }),
    );
    return generator;
  };

  const externalLanguageModel = (department: string): ILanguageModel => {
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: { purpose: string }) => {
        if (input.purpose === "documentGeneration") return ok({ object: { department }, usage });
        if (input.purpose === "documentGrading") {
          return ok({
            object: {
              guidanceAlignmentConfidence: 88,
              guidanceAlignmentRationale: "ok",
              criteriaAlignmentConfidence: 92,
              criteriaAlignmentRationale: "ok",
            },
            usage,
          });
        }
        return ok({ object: { summary: "A brief summary." }, usage });
      },
    );
    return languageModel;
  };

  const valueSetProvider = (options: { stale?: boolean } = {}) => ({
    list: vi.fn(),
    search: vi.fn(),
    probe: vi.fn(),
    match: vi.fn(async (input: { values: string[] }) =>
      ok({
        matches: input.values.map((value) => ({
          input: value,
          outcome: {
            kind: "candidates" as const,
            candidates: [
              {
                entry: { display: "Finance", key: "FIN-001" },
                score: 0.7,
                tier: "semantic" as const,
              },
            ],
          },
        })),
        stale: options.stale ?? false,
        version: SNAPSHOT_VERSION,
        fetchedAt: FETCHED_AT,
      }),
    ),
    resolve: vi.fn(async (_sourceName: string, values: string[]) => {
      const matched = values
        .filter((value) => value.toLowerCase() === "finance")
        .map((value) => ({ input: value, entry: { display: "Finance", key: "FIN-001" } }));
      return ok({
        matched,
        unresolved: values.filter((value) => value.toLowerCase() !== "finance"),
        ambiguous: [],
        stale: options.stale ?? false,
        version: SNAPSHOT_VERSION,
        fetchedAt: FETCHED_AT,
      });
    }),
  });

  const run = async (
    languageModel: ILanguageModel,
    provider: ReturnType<typeof valueSetProvider> | undefined,
    stepOutputs = makeStepOutputs(),
    documentGenerator = externalGenerator(),
  ) => {
    const useCase = new GenerateDocument(
      documentGenerator,
      makeObjectStorage(),
      languageModel,
      makeSessionMessages(),
      stepOutputs,
      provider,
    );
    const result = await useCase.execute({
      messageId: "msg-1",
      sessionId: "sess-1",
      messages: [makeMessage()],
      flow: makeFlow(),
      node: makeNode(),
    });
    return { result, documentGenerator, stepOutputs };
  };

  it("canonicalises the value and renders its key for the accessor", async () => {
    const { result, documentGenerator } = await run(
      externalLanguageModel("finance"),
      valueSetProvider(),
    );

    expect(result.error).toBeUndefined();
    const [generateInput] = (documentGenerator.generate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(generateInput.data.department).toBe("Finance");
    expect(generateInput.data.department_key).toBe("FIN-001");
  });

  it("stores the key and the snapshot on the step output", async () => {
    const stepOutputs = makeStepOutputs();
    await run(externalLanguageModel("finance"), valueSetProvider(), stepOutputs);

    const [createInput] = (stepOutputs.create as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(createInput.fields[0]).toMatchObject({
      key: "department",
      value: "Finance",
      valueKey: "FIN-001",
      sourceRef: { name: "departments", version: SNAPSHOT_VERSION, fetchedAt: FETCHED_AT },
    });
  });

  it("blocks generation when the value is not in the source", async () => {
    const { result, documentGenerator } = await run(
      externalLanguageModel("Marketing"),
      valueSetProvider(),
    );

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Department");
    expect(documentGenerator.generate).not.toHaveBeenCalled();
  });

  it("names what the operator probably meant, so the block can be answered", async () => {
    const { result } = await run(externalLanguageModel("Marketing"), valueSetProvider());

    expect(result.error?.message).toContain("did you mean Finance (FIN-001)?");
  });

  it("generates anyway when the set is stale, rather than halting on an outage", async () => {
    const { result } = await run(
      externalLanguageModel("Marketing"),
      valueSetProvider({ stale: true }),
    );

    expect(result.error).toBeUndefined();
  });

  it("generates normally when no provider is wired", async () => {
    const { result } = await run(externalLanguageModel("finance"), undefined);

    expect(result.error).toBeUndefined();
  });
});
