import { describe, expect, it, vi } from "vitest";
import type { RunAiTaskNodeInput } from "@rbrasier/application";

const { runMcpToolPrepass } = vi.hoisted(() => ({
  runMcpToolPrepass: vi.fn(async () => "\n\n<tool_results>\n- search: 3 hearings\n</tool_results>"),
}));
vi.mock("@/app/api/chat/[sessionId]/stream/mcp-turn-helpers", () => ({ runMcpToolPrepass }));
vi.mock("@/lib/chat/prompt-context", () => ({ resolveIsAdmin: async () => false }));

import { buildAiTaskContext } from "./ai-task-context";

const input = (config: Record<string, unknown>) =>
  ({
    session: { id: "session-1", userId: "owner-1" },
    flow: { id: "flow-1" },
    node: { id: "node-ai", config: { instruction: "Summarise.", ...config } },
    messages: [],
  }) as unknown as RunAiTaskNodeInput;

const container = (skillsOn: boolean) =>
  ({
    useCases: {
      isFeatureEnabledForUser: { execute: vi.fn(async () => ({ data: skillsOn })) },
      resolveStepSkills: { execute: vi.fn(async () => ({ data: [{ name: "Plain English", body: "Write simply." }] })) },
    },
  }) as never;

describe("buildAiTaskContext", () => {
  it("joins the step's skills and its tool results", async () => {
    const context = await buildAiTaskContext(container(true), input({ skillRefs: ["skill-1"] }));

    expect(context).toContain('<skill name="Plain English">');
    expect(context).toContain("<tool_results>");
    expect(runMcpToolPrepass).toHaveBeenCalledWith(
      expect.objectContaining({ lastUserMessage: "Summarise.", nodeId: "node-ai", sessionId: "session-1" }),
    );
  });

  it("leaves skills out while the skills flag is off", async () => {
    const context = await buildAiTaskContext(container(false), input({ skillRefs: ["skill-1"] }));

    expect(context).not.toContain("<skills>");
  });
});
