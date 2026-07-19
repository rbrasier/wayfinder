import { describe, expect, it, vi } from "vitest";
import { ok, err, domainError } from "@rbrasier/domain";
import type {
  FlowNode,
  ILanguageModel,
  ISessionStepOutputRepository,
  NewSessionStepOutput,
  SessionStepOutput,
} from "@rbrasier/domain";
import { CaptureStructuredStepOutput } from "./capture-structured-output";

const usage = {
  promptTokens: 10,
  completionTokens: 5,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const makeNode = (config: Record<string, unknown>): FlowNode =>
  ({ id: "node-1", flowId: "flow-1", type: "conversational", name: "Intake", config } as unknown as FlowNode);

const structuredConfig = {
  aiInstruction: "Capture the intake decision",
  doneWhen: "__TEMPLATE_COMPLETE__",
  outputType: "structured",
  structuredFields: [
    { key: "decision", label: "Decision", type: "text", optional: false, raw: "Decision" },
    { key: "owner", label: "Owner", type: "email", optional: false, raw: "Owner" },
  ],
};

const makeRepo = () => {
  const created: NewSessionStepOutput[] = [];
  const repo: ISessionStepOutputRepository = {
    create: vi.fn().mockImplementation(async (input: NewSessionStepOutput) => {
      created.push(input);
      return ok({ id: "out-1", createdAt: new Date(), updatedAt: new Date(), ...input } as unknown as SessionStepOutput);
    }),
    listByFlow: vi.fn(),
    listBySession: vi.fn(),
    findByMessageId: vi.fn(),
    updateFields: vi.fn(),
  };
  return { repo, created };
};

const makeLanguageModel = (extraction: Record<string, string>, fail = false): ILanguageModel => ({
  provider: "anthropic",
  generateObject: vi.fn().mockImplementation(async () =>
    fail ? err(domainError("INFRA_FAILURE", "extraction down")) : ok({ object: extraction, usage }),
  ),
  streamText: vi.fn(),
  streamObject: vi.fn(),
});

const baseInput = {
  sessionId: "session-1",
  flowId: "flow-1",
  messageId: "message-1",
  contextDocs: [],
  messages: [
    { role: "user" as const, content: "Approve the vendor, owner is alex@acme.com" },
    { role: "assistant" as const, content: "Recorded." },
  ],
};

describe("CaptureStructuredStepOutput", () => {
  it("extracts the structured field set and persists a step output", async () => {
    const { repo, created } = makeRepo();
    const languageModel = makeLanguageModel({ decision: "Approved", owner: "alex@acme.com" });
    const useCase = new CaptureStructuredStepOutput(languageModel, repo);

    const result = await useCase.execute({ ...baseInput, node: makeNode(structuredConfig) });

    expect(result.error).toBeUndefined();
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      sessionId: "session-1",
      flowId: "flow-1",
      nodeId: "node-1",
      messageId: "message-1",
    });
    expect(created[0]!.fields).toEqual([
      { key: "decision", label: "Decision", type: "text", options: undefined, value: "Approved" },
      { key: "owner", label: "Owner", type: "email", options: undefined, value: "alex@acme.com" },
    ]);
  });

  it("reuses precomputed field values without calling the model", async () => {
    const { repo, created } = makeRepo();
    const languageModel = makeLanguageModel({});
    const useCase = new CaptureStructuredStepOutput(languageModel, repo);

    const result = await useCase.execute({
      ...baseInput,
      node: makeNode(structuredConfig),
      fieldValues: { decision: "Rejected", owner: "jo@acme.com" },
    });

    expect(result.error).toBeUndefined();
    expect(languageModel.generateObject).not.toHaveBeenCalled();
    expect(created[0]!.fields[0]!.value).toBe("Rejected");
  });

  it("persists an empty record when the node declares no fields", async () => {
    const { repo, created } = makeRepo();
    const languageModel = makeLanguageModel({});
    const useCase = new CaptureStructuredStepOutput(languageModel, repo);

    const result = await useCase.execute({
      ...baseInput,
      node: makeNode({ ...structuredConfig, structuredFields: [] }),
    });

    expect(result.error).toBeUndefined();
    expect(languageModel.generateObject).not.toHaveBeenCalled();
    expect(created[0]!.fields).toEqual([]);
  });

  it("propagates an extraction failure", async () => {
    const { repo } = makeRepo();
    const languageModel = makeLanguageModel({}, true);
    const useCase = new CaptureStructuredStepOutput(languageModel, repo);

    const result = await useCase.execute({ ...baseInput, node: makeNode(structuredConfig) });

    expect(result.error?.code).toBe("INFRA_FAILURE");
    expect(repo.create).not.toHaveBeenCalled();
  });
});
