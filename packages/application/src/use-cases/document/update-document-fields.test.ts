import { describe, it, expect, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  IApprovalRepository,
  IAuditLogger,
  IDocumentGenerator,
  IFlowNodeRepository,
  ILanguageModel,
  IObjectStorage,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  FlowNode,
  Session,
  SessionDocument,
  SessionMessage,
  SessionStepOutput,
  StepOutputField,
} from "@rbrasier/domain";
import { UpdateDocumentFields } from "./update-document-fields";

const FIELDS = [
  { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
  { key: "amount", label: "Amount", type: "currency", optional: false, raw: "Amount" },
  { key: "risk_section", label: "Risk Section", type: "section", optional: true, raw: "#Risk Section" },
] as const;

const baseDocument = (): SessionDocument => ({
  filename: "rft.docx",
  storagePath: "generated/sess-1/rft.docx",
  summary: "Original summary.",
  generatedAt: "2026-06-01T00:00:00.000Z",
});

const makeMessage = (overrides: Partial<SessionMessage> = {}): SessionMessage => ({
  id: "msg-1",
  sessionId: "sess-1",
  role: "assistant",
  content: "Generated",
  senderUserId: null,
  confidence: 95,
  stepNodeId: "node-1",
  document: baseDocument(),
  documentStatus: "complete",
  aiPayload: null,
  createdAt: new Date(),
  ...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: null,
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeNode = (config: Record<string, unknown> = {}): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "conversational",
  name: "Generate RFT",
  colour: null,
  positionX: 0,
  positionY: 0,
  config: {
    aiInstruction: "Generate an RFT",
    doneWhen: "All gathered",
    outputType: "generate_document",
    documentTemplatePath: "templates/node-1/rft.docx",
    documentTemplateFields: FIELDS,
    ...config,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
});

const existingStepOutput = (): SessionStepOutput => ({
  id: "step-1",
  sessionId: "sess-1",
  flowId: "flow-1",
  nodeId: "node-1",
  messageId: "msg-1",
  fields: [
    { key: "supplier_name", label: "Supplier Name", type: "text", value: "Acme Ltd" },
    { key: "amount", label: "Amount", type: "currency", value: "$1,000.00" },
    { key: "risk_section", label: "Risk Section", type: "section", value: "No" },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeDocumentGenerator = (): IDocumentGenerator => ({
  extractTags: vi.fn().mockReturnValue(ok({ tags: [] })),
  extractFields: vi.fn().mockReturnValue(ok({ fields: FIELDS })),
  extractFullText: vi.fn().mockReturnValue(ok({ text: "" })),
  generate: vi.fn().mockReturnValue(ok({ bytes: Buffer.from("edited-docx") })),
});

const makeObjectStorage = (): IObjectStorage => ({
  put: vi.fn().mockResolvedValue(ok({ key: "generated/sess-1/rft-r1.docx" })),
  get: vi.fn().mockResolvedValue(ok(Buffer.from("template-bytes"))),
  delete: vi.fn().mockResolvedValue(ok(undefined)),
  exists: vi.fn().mockResolvedValue(ok(true)),
  initialise: vi.fn().mockResolvedValue(undefined),
});

const usage = { promptTokens: 1, completionTokens: 1, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { summary: "Refreshed summary." }, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeSessionMessages = (): ISessionMessageRepository => ({
  create: vi.fn(),
  findById: vi.fn().mockResolvedValue(ok(makeMessage())),
  listBySession: vi.fn().mockResolvedValue(ok([])),
  updateDocument: vi.fn().mockImplementation(async (_id, document) => ok(makeMessage({ document }))),
  updateDocumentStatus: vi.fn().mockResolvedValue(ok(makeMessage())),
  updateAiPayload: vi.fn().mockResolvedValue(ok(makeMessage())),
});

const makeStepOutputs = (): ISessionStepOutputRepository => ({
  create: vi.fn(),
  listByFlow: vi.fn().mockResolvedValue(ok([])),
  listBySession: vi.fn().mockResolvedValue(ok([])),
  findByMessageId: vi.fn().mockResolvedValue(ok(existingStepOutput())),
  updateFields: vi.fn().mockImplementation(
    async (id: string, fields: StepOutputField[]) =>
      ok({ ...existingStepOutput(), id, fields }),
  ),
});

const makeSessions = (session = makeSession()): ISessionRepository => ({
  create: vi.fn(),
  findById: vi.fn().mockResolvedValue(ok(session)),
  listByUser: vi.fn(),
  listAll: vi.fn(),
  update: vi.fn(),
  claimTurn: vi.fn(),
  heartbeatTurn: vi.fn(),
  releaseTurn: vi.fn(),
});

const makeFlowNodes = (node = makeNode()): IFlowNodeRepository => ({
  create: vi.fn(),
  findById: vi.fn().mockResolvedValue(ok(node)),
  listByFlow: vi.fn(),
  update: vi.fn(),
  updatePosition: vi.fn(),
  delete: vi.fn(),
});

const makeApprovals = (hasSnapshot = false): IApprovalRepository => ({
  create: vi.fn(),
  findById: vi.fn(),
  findPendingByNode: vi.fn(),
  listPendingForApprover: vi.fn(),
  listBySession: vi.fn(),
  update: vi.fn(),
  updateIfPending: vi.fn(),
  hasRecordedSnapshot: vi.fn().mockResolvedValue(ok(hasSnapshot)),
});

const makeAuditLogger = (): IAuditLogger => ({ log: vi.fn().mockResolvedValue(ok(true as const)) });

interface Deps {
  documentGenerator: IDocumentGenerator;
  objectStorage: IObjectStorage;
  languageModel: ILanguageModel;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  sessions: ISessionRepository;
  flowNodes: IFlowNodeRepository;
  approvals: IApprovalRepository;
  auditLogger: IAuditLogger;
}

const build = (overrides: Partial<Deps> = {}) => {
  const deps: Deps = {
    documentGenerator: makeDocumentGenerator(),
    objectStorage: makeObjectStorage(),
    languageModel: makeLanguageModel(),
    sessionMessages: makeSessionMessages(),
    sessionStepOutputs: makeStepOutputs(),
    sessions: makeSessions(),
    flowNodes: makeFlowNodes(),
    approvals: makeApprovals(),
    auditLogger: makeAuditLogger(),
    ...overrides,
  };
  const useCase = new UpdateDocumentFields(
    deps.documentGenerator,
    deps.objectStorage,
    deps.languageModel,
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.sessions,
    deps.flowNodes,
    deps.approvals,
    deps.auditLogger,
  );
  return { useCase, deps };
};

const validValues = {
  supplier_name: "Acme Ltd",
  amount: "$2,500.00",
  risk_section: "Yes",
};

describe("UpdateDocumentFields", () => {
  it("re-renders to a new versioned path, retaining the previous object", async () => {
    const { useCase, deps } = build();

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document?.storagePath).toBe("generated/sess-1/rft-r1.docx");
    expect(deps.objectStorage.put).toHaveBeenCalledWith(
      "generated/sess-1/rft-r1.docx",
      expect.any(Buffer),
      expect.stringContaining("wordprocessingml"),
    );
    // The prior object is never deleted.
    expect(deps.objectStorage.delete).not.toHaveBeenCalled();
  });

  it("keeps the .xlsx extension and spreadsheet MIME type for an xlsx template", async () => {
    const message = makeMessage({
      document: { ...baseDocument(), filename: "rft.xlsx", storagePath: "generated/sess-1/rft.xlsx" },
    });
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(message));
    const flowNodes = makeFlowNodes(makeNode({ documentTemplateFormat: "xlsx", spreadsheetTemplateMode: "header" }));
    const { useCase, deps } = build({ sessionMessages, flowNodes });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document?.storagePath).toBe("generated/sess-1/rft-r1.xlsx");
    expect(deps.objectStorage.put).toHaveBeenCalledWith(
      "generated/sess-1/rft-r1.xlsx",
      expect.any(Buffer),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  });

  it("increments the revision suffix on a subsequent edit", async () => {
    const message = makeMessage({
      document: { ...baseDocument(), storagePath: "generated/sess-1/rft-r3.docx" },
    });
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(message));
    const { useCase } = build({ sessionMessages });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.data?.document?.storagePath).toBe("generated/sess-1/rft-r4.docx");
  });

  it("updates the step output fields with the canonicalised values", async () => {
    const { useCase, deps } = build();

    await useCase.execute({ messageId: "msg-1", editedByUserId: "user-1", values: validValues });

    expect(deps.sessionStepOutputs.updateFields).toHaveBeenCalledWith(
      "step-1",
      expect.arrayContaining([
        expect.objectContaining({ key: "supplier_name", value: "Acme Ltd" }),
        expect.objectContaining({ key: "amount", value: "$2,500.00" }),
        expect.objectContaining({ key: "risk_section", value: "Yes" }),
      ]),
    );
  });

  it("stamps editedAt/editedByUserId and appends a DocumentEdit with before/after values", async () => {
    const { useCase, deps } = build();

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-7",
      values: validValues,
    });

    const document = result.data?.document;
    expect(document?.editedByUserId).toBe("user-7");
    expect(document?.editedAt).toBeTruthy();
    expect(document?.editHistory).toHaveLength(1);
    const edit = document?.editHistory?.[0];
    expect(edit?.storagePath).toBe("generated/sess-1/rft-r1.docx");
    // Only genuinely changed fields are recorded — supplier_name was unchanged.
    expect(edit?.changes).toEqual(
      expect.arrayContaining([
        { key: "amount", previousValue: "$1,000.00", newValue: "$2,500.00" },
        { key: "risk_section", previousValue: "No", newValue: "Yes" },
      ]),
    );
    expect(edit?.changes).not.toContainEqual(
      expect.objectContaining({ key: "supplier_name" }),
    );
    expect(deps.sessionMessages.updateDocument).toHaveBeenCalled();
  });

  it("preserves prior edit history when appending a new edit", async () => {
    const priorEdit = {
      editedAt: "2026-06-02T00:00:00.000Z",
      editedByUserId: "user-2",
      storagePath: "generated/sess-1/rft-r1.docx",
      changes: [{ key: "amount", previousValue: "$1.00", newValue: "$1,000.00" }],
    };
    const message = makeMessage({
      document: { ...baseDocument(), storagePath: "generated/sess-1/rft-r1.docx", editHistory: [priorEdit] },
    });
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(ok(message));
    const { useCase } = build({ sessionMessages });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.data?.document?.editHistory).toHaveLength(2);
    expect(result.data?.document?.editHistory?.[0]).toEqual(priorEdit);
  });

  it("writes a document.fields_edited audit event with the changed keys", async () => {
    const { useCase, deps } = build();

    await useCase.execute({ messageId: "msg-1", editedByUserId: "user-9", values: validValues });

    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-9",
        action: "document.fields_edited",
        resourceId: "msg-1",
        metadata: expect.objectContaining({
          changedKeys: expect.arrayContaining(["amount", "risk_section"]),
        }),
      }),
    );
  });

  it("refreshes the summary best-effort but keeps the old summary if the model fails", async () => {
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "model down")),
    );
    const { useCase, deps } = build({ languageModel });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.document?.summary).toBe("Original summary.");
    // No grading re-run on edit.
    const purposes = (deps.languageModel.generateObject as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { purpose: string }).purpose,
    );
    expect(purposes).not.toContain("documentGrading");
  });

  it("returns per-field errors and persists nothing when a value is invalid", async () => {
    const { useCase, deps } = build();

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: { supplier_name: "", amount: "not-money", risk_section: "Yes" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "supplier_name" }),
        expect.objectContaining({ key: "amount" }),
      ]),
    );
    expect(deps.objectStorage.put).not.toHaveBeenCalled();
    expect(deps.sessionStepOutputs.updateFields).not.toHaveBeenCalled();
    expect(deps.sessionMessages.updateDocument).not.toHaveBeenCalled();
  });

  it("blocks editing on a non-active session", async () => {
    const { useCase } = build({ sessions: makeSessions(makeSession({ status: "complete" })) });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("blocks editing once an approval snapshot has been recorded", async () => {
    const { useCase, deps } = build({ approvals: makeApprovals(true) });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
    expect(deps.objectStorage.put).not.toHaveBeenCalled();
  });

  it("blocks editing when the node disables manual editing", async () => {
    const { useCase } = build({ flowNodes: makeFlowNodes(makeNode({ allowManualEdit: false })) });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("errors when the message has no document", async () => {
    const sessionMessages = makeSessionMessages();
    (sessionMessages.findById as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok(makeMessage({ document: null })),
    );
    const { useCase } = build({ sessionMessages });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: validValues,
    });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("preserves a group's items on a scalar-field edit instead of blanking it", async () => {
    const groupFields = [
      { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
      {
        key: "suppliers",
        label: "Suppliers",
        type: "group",
        optional: true,
        raw: "#Suppliers (repeat)",
        itemFields: [{ key: "name", label: "Name", type: "text", optional: false, raw: "Name" }],
      },
    ] as const;
    const suppliersItems = [{ name: "Acme" }, { name: "Globex" }];

    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(
      ok({ fields: groupFields }),
    );
    const flowNodes = makeFlowNodes(makeNode({ documentTemplateFields: groupFields }));
    const sessionStepOutputs = makeStepOutputs();
    (sessionStepOutputs.findByMessageId as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        ...existingStepOutput(),
        fields: [
          { key: "supplier_name", label: "Supplier Name", type: "text", value: "Acme Ltd" },
          { key: "suppliers", label: "Suppliers", type: "group", value: "", items: suppliersItems },
        ],
      }),
    );

    const { useCase, deps } = build({ documentGenerator, flowNodes, sessionStepOutputs });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: { supplier_name: "New Name", suppliers: "" },
    });

    expect(result.error).toBeUndefined();
    // The regenerated document binds the preserved array, not a blank.
    const generateCall = (deps.documentGenerator.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(generateCall.data.suppliers).toEqual(suppliersItems);
    // The persisted step output keeps the items and a blank scalar value.
    expect(deps.sessionStepOutputs.updateFields).toHaveBeenCalledWith(
      "step-1",
      expect.arrayContaining([
        expect.objectContaining({ key: "suppliers", value: "", items: suppliersItems }),
      ]),
    );
  });

  const groupSetup = () => {
    const groupFields = [
      { key: "supplier_name", label: "Supplier Name", type: "text", optional: false, raw: "Supplier Name" },
      {
        key: "suppliers",
        label: "Suppliers",
        type: "group",
        optional: true,
        raw: "#Suppliers (repeat)",
        itemFields: [
          { key: "name", label: "Name", type: "text", optional: false, raw: "Name" },
          { key: "email", label: "Email", type: "email", optional: true, raw: "Email (email) (optional)" },
        ],
      },
    ] as const;
    const documentGenerator = makeDocumentGenerator();
    (documentGenerator.extractFields as ReturnType<typeof vi.fn>).mockReturnValue(ok({ fields: groupFields }));
    const flowNodes = makeFlowNodes(makeNode({ documentTemplateFields: groupFields }));
    const sessionStepOutputs = makeStepOutputs();
    (sessionStepOutputs.findByMessageId as ReturnType<typeof vi.fn>).mockResolvedValue(
      ok({
        ...existingStepOutput(),
        fields: [
          { key: "supplier_name", label: "Supplier Name", type: "text", value: "Acme Ltd" },
          { key: "suppliers", label: "Suppliers", type: "group", value: "", items: [{ name: "Acme", email: "" }] },
        ],
      }),
    );
    return { documentGenerator, flowNodes, sessionStepOutputs };
  };

  it("replaces group items with the submitted edit and records a group change", async () => {
    const { documentGenerator, flowNodes, sessionStepOutputs } = groupSetup();
    const { useCase, deps } = build({ documentGenerator, flowNodes, sessionStepOutputs });

    const newItems = [
      { name: "Acme", email: "hello@acme.com" },
      { name: "Globex", email: "" },
    ];
    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: { supplier_name: "Acme Ltd", suppliers: "" },
      groupItems: { suppliers: newItems },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.fieldErrors).toBeUndefined();
    const generateCall = (deps.documentGenerator.generate as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(generateCall.data.suppliers).toEqual(newItems);
    expect(deps.sessionStepOutputs.updateFields).toHaveBeenCalledWith(
      "step-1",
      expect.arrayContaining([
        expect.objectContaining({ key: "suppliers", value: "", items: newItems }),
      ]),
    );
    const edit = result.data?.document?.editHistory?.[0];
    expect(edit?.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "suppliers" })]),
    );
  });

  it("returns a field error and persists nothing when a submitted group item is invalid", async () => {
    const { documentGenerator, flowNodes, sessionStepOutputs } = groupSetup();
    const { useCase, deps } = build({ documentGenerator, flowNodes, sessionStepOutputs });

    const result = await useCase.execute({
      messageId: "msg-1",
      editedByUserId: "user-1",
      values: { supplier_name: "Acme Ltd", suppliers: "" },
      groupItems: { suppliers: [{ name: "", email: "bad-email" }] },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "suppliers" })]),
    );
    expect(deps.objectStorage.put).not.toHaveBeenCalled();
    expect(deps.sessionStepOutputs.updateFields).not.toHaveBeenCalled();
  });
});
