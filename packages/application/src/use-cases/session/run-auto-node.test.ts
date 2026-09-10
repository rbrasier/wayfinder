import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@wayfinder/domain";
import type {
  Flow,
  FlowNode,
  ILanguageModel,
  INodeExecutor,
  ISessionRepository,
  ISessionStepOutputRepository,
  NodeExecutionInput,
  Session,
  SessionMessage,
  SessionStepOutput,
} from "@wayfinder/domain";
import { RunAutoNode } from "./run-auto-node";

const usage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: "sess-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Buy laptops",
  currentNodeId: "node-1",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeFlow = (): Flow => ({
  id: "flow-1",
  name: "Procurement Flow",
  description: null,
  icon: null,
  expertRole: null,
  ownerUserId: "user-1",
  status: "published",
  visibility: { kind: "private" },
  permissions: [],
  contextDocs: [],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeNode = (config: Record<string, unknown>): FlowNode => ({
  id: "node-1",
  flowId: "flow-1",
  type: "auto",
  name: "Vendor lookup",
  colour: null,
  positionX: 0,
  positionY: 0,
  config,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const makeMessages = (): SessionMessage[] => [
  { id: "m1", sessionId: "sess-1", role: "user", content: "I need laptops", confidence: null, stepNodeId: "node-1", document: null, createdAt: new Date() },
];

const makeSessions = (session: Session): ISessionRepository =>
  ({
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(ok(session)),
    listByUser: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn().mockImplementation(async (_id, patch) => ok({ ...session, ...patch })),
  }) as unknown as ISessionRepository;

const makeLanguageModel = (): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockResolvedValue(ok({ object: { category: "IT Hardware" }, usage })),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const makeStepOutputs = (
  outputs: SessionStepOutput[] = [],
): ISessionStepOutputRepository =>
  ({
    create: vi.fn(),
    listByFlow: vi.fn().mockResolvedValue(ok([])),
    listBySession: vi.fn().mockResolvedValue(ok(outputs)),
  }) as unknown as ISessionStepOutputRepository;

const makeExecutor = (): INodeExecutor & { lastInput: NodeExecutionInput | null } => {
  const ref = { lastInput: null as NodeExecutionInput | null };
  return {
    execute: vi.fn().mockImplementation(async (input: NodeExecutionInput) => {
      ref.lastInput = input;
      return ok({ status: "pending", data: {} });
    }),
    get lastInput() {
      return ref.lastInput;
    },
  } as unknown as INodeExecutor & { lastInput: NodeExecutionInput | null };
};

const baseConfig = {
  instruction: "Look up the preferred vendor.",
  executor: "n8n",
  webhookUrl: "https://n8n.example.com/webhook/abc",
  requestFields: [
    { key: "category", label: "Category", type: "text", optional: false, raw: "Category" },
  ],
  responseFields: [
    { key: "vendor", label: "Vendor", type: "text", optional: false, raw: "Vendor" },
  ],
};

describe("RunAutoNode", () => {
  it("records a pending execution keyed by a generated correlation id and dispatches the executor", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const executor = makeExecutor();

    const useCase = new RunAutoNode(sessions, makeLanguageModel(), { n8n: executor, mock: executor }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date("2026-05-30T10:00:00.000Z"),
    });

    const result = await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode(baseConfig),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.correlationId).toBe("corr-123");
    expect(result.data?.status).toBe("pending");

    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: {
        "corr-123": { nodeId: "node-1", status: "pending", sentAt: "2026-05-30T10:00:00.000Z" },
      },
    });
  });

  it("gathers request fields and passes them on the executor input alongside instruction and correlation id", async () => {
    const session = makeSession();
    const executor = makeExecutor();

    const useCase = new RunAutoNode(makeSessions(session), makeLanguageModel(), { n8n: executor, mock: executor }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date("2026-05-30T10:00:00.000Z"),
    });

    await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode(baseConfig),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "admin",
    });

    expect(executor.lastInput).toMatchObject({
      nodeId: "node-1",
      sessionId: "sess-1",
      userId: "user-1",
      userRole: "admin",
      flowId: "flow-1",
      sessionTitle: "Buy laptops",
      instruction: "Look up the preferred vendor.",
      correlationId: "corr-123",
      webhookUrl: "https://n8n.example.com/webhook/abc",
      fields: { category: "IT Hardware" },
    });
    expect(executor.lastInput?.flowSlug).toBe("procurement-flow");
  });

  it("preserves existing pending executions when adding a new one", async () => {
    const session = makeSession({
      pendingExecutions: { "old-corr": { nodeId: "node-9", status: "pending", sentAt: "2026-05-01T00:00:00.000Z" } },
    });

    const sessions = makeSessions(session);
    const useCase = new RunAutoNode(sessions, makeLanguageModel(), { n8n: makeExecutor(), mock: makeExecutor() }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date("2026-05-30T10:00:00.000Z"),
    });

    await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode(baseConfig),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(sessions.update).toHaveBeenCalledWith("sess-1", {
      pendingExecutions: {
        "old-corr": { nodeId: "node-9", status: "pending", sentAt: "2026-05-01T00:00:00.000Z" },
        "corr-123": { nodeId: "node-1", status: "pending", sentAt: "2026-05-30T10:00:00.000Z" },
      },
    });
  });

  it("dispatches with empty fields when the node declares no request fields", async () => {
    const session = makeSession();
    const executor = makeExecutor();
    const languageModel = makeLanguageModel();

    const useCase = new RunAutoNode(makeSessions(session), languageModel, { n8n: executor, mock: executor }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date(),
    });

    await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode({ ...baseConfig, requestFields: [] }),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(languageModel.generateObject).not.toHaveBeenCalled();
    expect(executor.lastInput?.fields).toEqual({});
  });

  it("returns a validation error when an n8n node has no webhook URL", async () => {
    const session = makeSession();

    const useCase = new RunAutoNode(makeSessions(session), makeLanguageModel(), { n8n: makeExecutor(), mock: makeExecutor() }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date(),
    });

    const result = await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode({ ...baseConfig, webhookUrl: "" }),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("does not record a pending execution when field extraction fails", async () => {
    const session = makeSession();
    const sessions = makeSessions(session);
    const languageModel = makeLanguageModel();
    (languageModel.generateObject as ReturnType<typeof vi.fn>).mockResolvedValue(
      err(domainError("INFRA_FAILURE", "model down")),
    );

    const useCase = new RunAutoNode(sessions, languageModel, { n8n: makeExecutor(), mock: makeExecutor() }, makeStepOutputs(), {
      generateCorrelationId: () => "corr-123",
      now: () => new Date(),
    });

    const result = await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode(baseConfig),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(result.error).toBeDefined();
    expect(sessions.update).not.toHaveBeenCalled();
  });

  it("resolves a request field bound to a prior step output without calling the model", async () => {
    const session = makeSession();
    const executor = makeExecutor();
    const languageModel = makeLanguageModel();
    const priorOutput: SessionStepOutput = {
      id: "out-1",
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-0",
      messageId: null,
      fields: [{ key: "vendor", label: "Vendor", type: "text", value: "Acme Corp" }],
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };

    const useCase = new RunAutoNode(
      makeSessions(session),
      languageModel,
      { n8n: executor, mock: executor },
      makeStepOutputs([priorOutput]),
      { generateCorrelationId: () => "corr-123", now: () => new Date() },
    );

    await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode({
        ...baseConfig,
        requestFields: [
          { key: "category", label: "Category", type: "text", optional: false, raw: "Category" },
        ],
        requestFieldValues: {
          category: { kind: "step_field", nodeId: "node-0", fieldKey: "vendor" },
        },
      }),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(languageModel.generateObject).not.toHaveBeenCalled();
    expect(executor.lastInput?.fields).toEqual({ category: "Acme Corp" });
  });

  it("routes to the mock executor and returns its synchronous completed data", async () => {
    const session = makeSession();
    const n8nExecutor = makeExecutor();
    const mockExecutor: INodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValue(ok({ status: "completed", data: { vendor: "Mocked Co" } })),
    };

    const useCase = new RunAutoNode(
      makeSessions(session),
      makeLanguageModel(),
      { n8n: n8nExecutor, mock: mockExecutor },
      makeStepOutputs(),
      { generateCorrelationId: () => "corr-123", now: () => new Date() },
    );

    const result = await useCase.execute({
      session,
      flow: makeFlow(),
      node: makeNode({ ...baseConfig, executor: "mock", webhookUrl: "" }),
      messages: makeMessages(),
      userId: "user-1",
      userRole: "user",
    });

    expect(mockExecutor.execute).toHaveBeenCalled();
    expect(n8nExecutor.execute).not.toHaveBeenCalled();
    expect(result.data?.status).toBe("completed");
    expect(result.data?.data).toEqual({ vendor: "Mocked Co" });
  });
});
