import { describe, expect, it, vi } from "vitest";
import type {
  Flow,
  FlowNode,
  Session,
  TokenUsage,
  TurnStreamWriter,
} from "@rbrasier/domain";
import { CROSS_CHECK_PASS_NOTE } from "./turn-helpers";
import { executeTurn, type ExecuteTurnInput } from "./execute-turn";

const okUsage: TokenUsage = {
  promptTokens: 1,
  completionTokens: 1,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

// Records the ordered semantic writer operations so a test can assert both the
// bubble boundaries and the streamed text/annotations the turn produces.
const recordingWriter = () => {
  const ops: string[] = [];
  const texts: string[] = [];
  const annotations: unknown[] = [];
  const writer: TurnStreamWriter = {
    writeText: (text) => {
      ops.push(`text:${text}`);
      texts.push(text);
    },
    endBubble: () => {
      ops.push("boundary");
    },
    writeAnnotation: (annotation) => {
      ops.push(`annotation:${annotation.type}`);
      annotations.push(annotation);
    },
  };
  return { writer, ops, texts, annotations };
};

// An ILanguageModel double: streamObject yields one growing response prefix (so
// streamTurn writes it once) and resolves the turn object; generateObject backs
// the branch-choice call.
const fakeLlm = (responseText: string, confidence: number) => {
  const streamObject = vi.fn(async () => {
    async function* stream() {
      yield { response: responseText };
    }
    return {
      data: {
        partialObjectStream: stream(),
        object: Promise.resolve({
          response: responseText,
          rationale: "r",
          stepCompleteConfidence: confidence,
          contextGathered: [],
        }),
        usage: Promise.resolve(okUsage),
      },
    };
  });
  const generateObject = vi.fn(async () => ({
    data: { object: { branchChoice: null }, usage: okUsage },
    error: null,
  }));
  return {
    provider: "anthropic" as const,
    streamObject,
    generateObject,
    streamText: vi.fn(),
    generateText: vi.fn(),
  };
};

type Evaluation = {
  passed: boolean;
  missingInformation: string[];
  fieldValues: Record<string, string>;
  guidanceAlignmentConfidence: number;
  guidanceAlignmentRationale: string;
  criteriaAlignmentConfidence: number;
  criteriaAlignmentRationale: string;
};

const passEvaluation: Evaluation = {
  passed: true,
  missingInformation: [],
  fieldValues: {},
  guidanceAlignmentConfidence: 90,
  guidanceAlignmentRationale: "",
  criteriaAlignmentConfidence: 90,
  criteriaAlignmentRationale: "",
};

const buildScenario = (options: {
  confidence?: number;
  evaluation?: Evaluation | null;
  quotaBlocked?: boolean;
} = {}) => {
  const confidence = options.confidence ?? 95;
  const session = {
    id: "sess-1",
    currentNodeId: "node-1",
    status: "active",
  } as unknown as Session;

  const currentNode = {
    id: "node-1",
    name: "Draft",
    type: "conversational",
    config: { outputType: "generate_document", documentTemplatePath: "t.docx" },
  } as unknown as FlowNode;

  const flow = {
    id: "flow-1",
    name: "Flow",
    contextDocs: [{ filename: "policy.pdf" }],
    deletedAt: null,
  } as unknown as Flow;

  const create = vi.fn(async (message: { role: string; content: string }) => {
    void message;
    return { data: { id: "created-1" }, error: null };
  });
  const persistAssistantTurn = vi.fn(async () => ({
    data: { advanced: false, session, newNodeId: null },
    error: null,
  }));
  const evaluate = vi.fn(async () => ({ data: options.evaluation, error: null }));
  const llm = fakeLlm("Here is the plan.", confidence);

  const container = {
    useCases: {
      runTurn: {
        persistUserMessage: vi.fn(async () => ({ data: { seq: 1 }, error: null })),
        persistAssistantTurn,
      },
      evaluateStepReadiness: { execute: evaluate },
    },
    services: {
      quotaEnforcer: {
        check: vi.fn(async () =>
          options.quotaBlocked
            ? { error: { code: "QUOTA", message: "You are over your limit." } }
            : { error: null },
        ),
      },
      llm,
      sessionAgent: { buildBranchChoicePrompt: vi.fn(() => ({ data: "bp", error: null })) },
      errorLogger: { log: vi.fn(async () => {}) },
    },
    repos: {
      sessionMessages: {
        create,
        findById: vi.fn(async () => ({ data: { aiPayload: { contextGathered: [] } }, error: null })),
        updateAiPayload: vi.fn(async () => ({ data: {}, error: null })),
        listBySession: vi.fn(async () => ({ data: [], error: null })),
      },
    },
    runtimeConfig: { resolveDocumentGenerationBudget: vi.fn(async () => undefined) },
  } as unknown as ExecuteTurnInput["container"];

  const { writer, ops, texts, annotations } = recordingWriter();

  const input: ExecuteTurnInput = {
    container,
    writer,
    publishEvent: vi.fn(),
    session,
    flow,
    nodes: [currentNode],
    currentNode,
    nodeConfig: currentNode.config as unknown as ExecuteTurnInput["nodeConfig"],
    // A prior user message so the best-effort title generation is skipped.
    dbMessages: [{ role: "user", content: "hi" }] as ExecuteTurnInput["dbMessages"],
    currentNodeAssistantMessages: [],
    messagesWithNew: [{ role: "user", content: "hi" }],
    systemPrompt: "system",
    gatheredContext: "",
    branchNodes: [],
    isNeverDone: false,
    requireConfirmation: false,
    realThreshold: 90,
    organisationName: null,
    globalInstructions: null,
    userProfile: null,
    chatModelName: "chat-model",
    branchingModelName: "branch-model",
    userId: "user-1",
    isAdmin: false,
    lastUserMessage: "hi",
  };

  return { input, container, writer, ops, texts, annotations, create, persistAssistantTurn, evaluate };
};

describe("executeTurn", () => {
  it("blocks on a quota error before streaming, writing the notice and a system message", async () => {
    const scenario = buildScenario({ quotaBlocked: true });

    await executeTurn(scenario.input);

    expect(scenario.texts).toEqual(["You are over your limit."]);
    expect(scenario.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "system", content: "You are over your limit." }),
    );
    expect(scenario.persistAssistantTurn).not.toHaveBeenCalled();
    expect((scenario.container as never as { services: { llm: { streamObject: ReturnType<typeof vi.fn> } } }).services.llm.streamObject).not.toHaveBeenCalled();
  });

  it("streams the reply, emits a confidence annotation, and persists the assistant turn when the gate is skipped", async () => {
    // Below threshold → the readiness gate does not run at all.
    const scenario = buildScenario({ confidence: 40, evaluation: null });

    await executeTurn(scenario.input);

    expect(scenario.texts).toEqual(["Here is the plan."]);
    expect(scenario.ops).toContain("annotation:confidence");
    expect(scenario.ops).not.toContain("annotation:cross-checking");
    expect(scenario.evaluate).not.toHaveBeenCalled();
    expect(scenario.persistAssistantTurn).toHaveBeenCalledTimes(1);
  });

  it("on a cross-check PASS, streams the pass note as a new bubble and persists it after the assistant turn", async () => {
    const scenario = buildScenario({ confidence: 95, evaluation: passEvaluation });

    await executeTurn(scenario.input);

    // cross-checking toggles on then off around the evaluation.
    expect(scenario.ops.filter((op) => op === "annotation:cross-checking")).toHaveLength(2);
    // The pass note opens a NEW bubble (boundary) then its text.
    const boundaryIndex = scenario.ops.indexOf("boundary");
    expect(boundaryIndex).toBeGreaterThan(-1);
    expect(scenario.ops[boundaryIndex + 1]).toBe(`text:${CROSS_CHECK_PASS_NOTE}`);
    expect(scenario.persistAssistantTurn).toHaveBeenCalledTimes(1);
    // The pass note is also persisted as a system message on the node.
    expect(scenario.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "system", content: CROSS_CHECK_PASS_NOTE }),
    );
  });

  it("on a cross-check HOLD, persists the overruled reply, streams a follow-up as a new bubble, and does not advance", async () => {
    const holdEvaluation: Evaluation = {
      ...passEvaluation,
      passed: false,
      missingInformation: ["the end date"],
    };
    const scenario = buildScenario({ confidence: 95, evaluation: holdEvaluation });

    await executeTurn(scenario.input);

    // A boundary precedes the streamed follow-up so it renders as its own bubble.
    expect(scenario.ops).toContain("boundary");
    // The overruled reply and the follow-up are both persisted (two creates);
    // the pass note is not, and the turn does not advance.
    expect(scenario.create.mock.calls.filter((call) => call[0].role === "assistant").length).toBeGreaterThanOrEqual(1);
    expect(scenario.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: CROSS_CHECK_PASS_NOTE }),
    );
    expect(scenario.persistAssistantTurn).not.toHaveBeenCalled();
  });
});
