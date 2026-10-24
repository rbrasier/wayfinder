import { describe, expect, it, vi } from "vitest";
import type { McpToolCallRecord, SessionMessage } from "@rbrasier/domain";

vi.mock("@rbrasier/adapters", () => ({ resolveModel: () => ({}) }));

import { buildToolPrepassSystemPrompt, runMcpToolPrepass, type RunMcpToolPrepassInput } from "./mcp-turn-helpers";

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

    expect(prompt).toContain("- get_transcript: Senators asked about staffing levels.");
  });
});

describe("runMcpToolPrepass", () => {
  it("returns the tool results apart from the gathered context", async () => {
    const harness = container();
    const result = await runMcpToolPrepass(input({ container: harness.container }));

    expect(result.toolResults).toBe("- get_transcript: Senators asked about staffing levels.");
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
