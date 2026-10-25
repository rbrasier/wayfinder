import { describe, expect, it, vi } from "vitest";
import type { McpToolCallRecord, SessionMessage, ToolRecordCitation } from "@wayfinder/domain";

vi.mock("@wayfinder/adapters", () => ({ resolveModel: () => ({}) }));

import {
  buildToolPrepassSystemPrompt,
  citedSourcesFor,
  renderToolResults,
  runMcpToolPrepass,
  TOOL_RESULTS_PROMPT_BUDGET_CHARS,
  type RunMcpToolPrepassInput,
} from "./mcp-turn-helpers";

const citation = (locator: string, overrides: Partial<ToolRecordCitation> = {}): ToolRecordCitation => ({
  serverId: "mcp-1",
  serverLabel: "Legislation",
  toolName: "search",
  locator,
  title: `Act ${locator}`,
  url: `https://legislation.example/${locator}`,
  recordedAt: null,
  ...overrides,
});

const record = (overrides: Partial<McpToolCallRecord> = {}): McpToolCallRecord => ({
  serverLabel: "Legislation",
  toolName: "search",
  arguments: "{}",
  result: "Water Act text",
  calledAt: "2026-10-17T00:00:00.000Z",
  ...overrides,
});

describe("renderToolResults", () => {
  it("numbers each source record and lists it under the call that found it", () => {
    const rendered = renderToolResults([
      record({ citations: [citation("a"), citation("b")] }),
      record({ toolName: "lookup", result: "Fire Act text", citations: [citation("c", { url: null })] }),
    ]);

    expect(rendered.numbered.map((entry) => entry.marker)).toEqual(["S1", "S2", "S3"]);
    expect(rendered.text).toContain("- search (Legislation): Water Act text");
    expect(rendered.text).toContain("[S1] Act a — a (https://legislation.example/a)");
    expect(rendered.text).toContain("[S3] Act c — c");
    expect(rendered.text).toContain("cite it with its marker");
  });

  it("gives a record found twice one marker", () => {
    const rendered = renderToolResults([record({ citations: [citation("a")] }), record({ citations: [citation("a")] })]);

    expect(rendered.numbered).toHaveLength(1);
  });

  it("renders a legacy record with no citations, and no citation instruction when nothing can be cited", () => {
    const rendered = renderToolResults([record()]);

    expect(rendered.text).toBe("- search (Legislation): Water Act text");
    expect(rendered.numbered).toEqual([]);
  });

  it("re-injects a large earlier result whole while it fits the budget", () => {
    const large = "z".repeat(50_000);
    const rendered = renderToolResults([record({ result: large })]);

    expect(rendered.text).toContain(large);
    expect(rendered.text).not.toContain("omitted");
  });

  it("cuts the oldest results first past the budget, and says how much was left out", () => {
    const oldest = "o".repeat(TOOL_RESULTS_PROMPT_BUDGET_CHARS);
    const newest = "n".repeat(1_000);
    const rendered = renderToolResults([record({ result: oldest }), record({ result: newest })]);

    expect(rendered.text).toContain(newest);
    expect(rendered.text).toContain("[1000 characters omitted — call the tool again for the full result]");
  });

  it("notes a result that was already cut when it was stored", () => {
    const rendered = renderToolResults([record({ truncated: true })]);

    expect(rendered.text).toContain("stored result was cut");
  });
});

describe("citedSourcesFor", () => {
  it("keeps only the records the reply cited", () => {
    const { numbered } = renderToolResults([record({ citations: [citation("a"), citation("b")] })]);

    expect(citedSourcesFor("The Act [S2] applies.", numbered)).toEqual([{ ...citation("b"), marker: "S2" }]);
  });

  it("returns undefined when the reply cited nothing, so the payload carries no empty member", () => {
    expect(citedSourcesFor("No markers.", [])).toBeUndefined();
  });
});

const transcriptCall: McpToolCallRecord = {
  serverLabel: "ParlView",
  toolName: "get_transcript",
  arguments: '{"parlViewId":"5976131"}',
  result: "Senators asked about staffing levels.",
  calledAt: "2026-10-24T10:00:00.000Z",
};

const container = (toolCalls: McpToolCallRecord[] = [transcriptCall]) => {
  const create = vi.fn(async () => ({ data: { id: "note-1" } }));
  const run = vi.fn(async () => ({ data: { toolCalls, summary: "Fetched the transcript." } }));
  return {
    create,
    run,
    container: {
      useCases: {
        isFeatureEnabledForUser: { execute: async () => ({ data: true }) },
        resolveStepTools: {
          execute: async () => ({
            data: {
              refs: [{ serverId: "server-1", toolName: "get_transcript" }],
              servers: [{ id: "server-1", label: "ParlView" }],
            },
          }),
        },
      },
      runtimeConfig: {
        getAiConfig: async () => ({ provider: "anthropic", models: { chat: "chat-model" }, apiKeys: {} }),
      },
      services: { mcpToolPrepass: { run } },
      repos: { sessionMessages: { create } },
    } as never,
  };
};

const input = (overrides: Partial<RunMcpToolPrepassInput> = {}): RunMcpToolPrepassInput => ({
  container: container().container,
  nodeConfig: { allowedMcpToolRefs: ["server-1:get_transcript"] } as never,
  dbMessages: [] as SessionMessage[],
  lastUserMessage: "What did the hearing cover?",
  stepBrief: "Summarise the hearing.",
  gatheredContext: "- parlViewId: 5976131",
  userId: "user-1",
  isAdmin: false,
  flowId: "flow-1",
  sessionId: "session-1",
  nodeId: "node-1",
  publishEvent: () => undefined,
  ...overrides,
});

describe("buildToolPrepassSystemPrompt", () => {
  it("gives the tool loop the step's brief and what is already known, and tells it to look things up", () => {
    const prompt = buildToolPrepassSystemPrompt({
      stepBrief: "Summarise the hearing.",
      gatheredContext: "- parlViewId: 5976131",
      priorToolCalls: [],
    });

    expect(prompt).toContain("Summarise the hearing.");
    expect(prompt).toContain("parlViewId: 5976131");
    expect(prompt).toMatch(/rather than asking the user/i);
  });

  it("lists what earlier lookups already returned, so they are not repeated", () => {
    const prompt = buildToolPrepassSystemPrompt({
      stepBrief: "Summarise the hearing.",
      gatheredContext: "",
      priorToolCalls: [transcriptCall],
    });

    expect(prompt).toContain("- get_transcript (ParlView): Senators asked about staffing levels.");
  });
});

describe("runMcpToolPrepass", () => {
  it("returns the tool results apart from the gathered context", async () => {
    const harness = container();
    const result = await runMcpToolPrepass(input({ container: harness.container }));

    expect(result.toolResults).toBe("- get_transcript (ParlView): Senators asked about staffing levels.");
    expect(harness.run).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining("parlViewId: 5976131") }),
    );
  });

  it("writes the audit note only when asked to, so the caller can place it after the user's message", async () => {
    const harness = container();
    const result = await runMcpToolPrepass(input({ container: harness.container }));

    expect(harness.create).not.toHaveBeenCalled();
    await result.recordAudit();
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({ role: "system", content: "Consulted 1 tool call (get_transcript)." }),
    );
  });

  it("returns no results and records nothing when the step allows no tools", async () => {
    const harness = container();
    const onActivity = vi.fn();
    const result = await runMcpToolPrepass(
      input({ container: harness.container, nodeConfig: { allowedMcpToolRefs: [] } as never, onActivity }),
    );

    expect(result.toolResults).toBe("");
    await result.recordAudit();
    expect(harness.create).not.toHaveBeenCalled();
    expect(onActivity).not.toHaveBeenCalled();
  });

  it("says which servers it is consulting while the lookup runs, then that it has finished", async () => {
    const harness = container();
    const activity: (readonly string[] | null)[] = [];
    harness.run.mockImplementation(async () => {
      activity.push(["running"]);
      return { data: { toolCalls: [transcriptCall], summary: "" } };
    });

    await runMcpToolPrepass(
      input({ container: harness.container, onActivity: (sources) => activity.push(sources) }),
    );

    expect(activity).toEqual([["ParlView"], ["running"], null]);
  });
});
