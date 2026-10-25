import { describe, expect, it, vi } from "vitest";
import type { Flow, FlowNode } from "@wayfinder/domain";
import { generateInitialMessage } from "./turn-helpers";
import type * as McpTurnHelpers from "./mcp-turn-helpers";

// Split from turn-helpers.test.ts by subject (the size ceiling): the opening
// message's handling of fields whose options come from a lookup source.

const { runMcpToolPrepass } = vi.hoisted(() => ({
  runMcpToolPrepass: vi.fn(async () => ({ toolResults: "", numberedCitations: [], recordAudit: async () => {} })),
}));
vi.mock("./mcp-turn-helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof McpTurnHelpers>()),
  runMcpToolPrepass,
}));

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

describe("generateInitialMessage — external-sourced fields", () => {
  const externalNode = () =>
    makeNode({
      config: {
        aiInstruction: "Gather the department",
        doneWhen: "Department captured",
        outputType: "structured",
        advanceConfidenceThreshold: 90,
        structuredFields: [
          {
            key: "department",
            label: "Department",
            type: "text",
            optionsSource: "departments",
            optional: false,
            raw: "Department (options-source: departments)",
          },
        ],
      },
    } as unknown as Partial<FlowNode>);

  const containerWith = (
    buildSystemPrompt: ReturnType<typeof vi.fn>,
    valueSetProvider?: unknown,
  ) =>
    ({
      services: {
        llm: {
          provider: "anthropic",
          generateObject: vi.fn().mockResolvedValue({
            data: {
              object: { response: "Hi", rationale: "r", stepCompleteConfidence: 0, contextGathered: [] },
              usage: { promptTokens: 1, completionTokens: 1, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            },
          }),
          streamText: vi.fn(),
          streamObject: vi.fn(),
        },
        sessionAgent: { buildSystemPrompt },
        errorLogger: { log: vi.fn().mockResolvedValue({ data: undefined, error: null }) },
        ...(valueSetProvider ? { valueSetProvider } : {}),
      },
      repos: {
        sessionMessages: { create: vi.fn().mockResolvedValue({ data: {}, error: null }) },
        sessionUploads: { listBySession: vi.fn().mockResolvedValue({ data: [], error: null }) },
        usageRepo: {},
      },
      runtimeConfig: {
        getSessionUploadConfig: vi
          .fn()
          .mockResolvedValue({ maxFileSizeBytes: 1, totalBudgetChars: 1000 }),
      },
      useCases: {
        retrieveDocumentChunks: { execute: vi.fn().mockResolvedValue({ data: [], error: null }) },
        resolveStepSkills: { execute: vi.fn().mockResolvedValue({ data: [], error: null }) },
      },
    }) as unknown as Parameters<typeof generateInitialMessage>[0]["container"];

  const run = async (container: Parameters<typeof generateInitialMessage>[0]["container"]) =>
    generateInitialMessage({
      container,
      sessionId: "sess-1",
      newNodeId: "node-2",
      newNode: externalNode(),
      flow: makeFlow(),
      modelName: "claude-haiku-4-5-20251001",
      organisationName: "Acme",
      userProfile: null,
      userId: "user-1",
      isAdmin: false,
      gatheredContext: "",
      globalInstructions: null,
    });

  it("inlines a small set into the fields the live turn's prompt is built from", async () => {
    const buildSystemPrompt = vi.fn().mockReturnValue({ data: "system-prompt", error: null });
    const valueSetProvider = {
      list: vi.fn().mockResolvedValue({
        data: {
          entries: [
            { display: "Finance", key: "FIN-001" },
            { display: "Legal", key: "LEG-003" },
          ],
          version: "v1",
          fetchedAt: new Date(0),
          stale: false,
        },
      }),
      search: vi.fn(),
      resolve: vi.fn(),
      probe: vi.fn(),
    };

    await run(containerWith(buildSystemPrompt, valueSetProvider));

    const call = buildSystemPrompt.mock.calls[0]![0];
    expect(call.templateFields[0].options).toEqual(["Finance (FIN-001)", "Legal (LEG-003)"]);
  });

  it("leaves a large set out of the live turn's prompt", async () => {
    const buildSystemPrompt = vi.fn().mockReturnValue({ data: "system-prompt", error: null });
    const valueSetProvider = {
      list: vi.fn().mockResolvedValue({
        data: {
          entries: Array.from({ length: 40 }, (_, index) => ({ display: `Dept ${index}` })),
          version: "v1",
          fetchedAt: new Date(0),
          stale: false,
        },
      }),
      search: vi.fn(),
      resolve: vi.fn(),
      probe: vi.fn(),
    };

    await run(containerWith(buildSystemPrompt, valueSetProvider));

    const call = buildSystemPrompt.mock.calls[0]![0];
    expect(call.templateFields[0].options).toBeUndefined();
    expect(call.templateFields[0].optionsSource).toBe("departments");
  });

  it("still builds the turn when no provider is wired", async () => {
    const buildSystemPrompt = vi.fn().mockReturnValue({ data: "system-prompt", error: null });

    await run(containerWith(buildSystemPrompt));

    expect(buildSystemPrompt).toHaveBeenCalledTimes(1);
    expect(buildSystemPrompt.mock.calls[0]![0].templateFields[0].options).toBeUndefined();
  });
});
