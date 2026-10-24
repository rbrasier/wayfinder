import { describe, expect, it, vi } from "vitest";
import type { RunAiTaskNodeInput } from "@rbrasier/application";

const { runMcpToolPrepass, recordAudit } = vi.hoisted(() => {
  const recordAudit = vi.fn(async () => {});
  return {
    recordAudit,
    runMcpToolPrepass: vi.fn(async () => ({ toolResults: "- search: 3 hearings", recordAudit })),
  };
});
vi.mock("@/app/api/chat/[sessionId]/stream/mcp-turn-helpers", () => ({ runMcpToolPrepass }));
vi.mock("@/lib/chat/prompt-context", () => ({ resolveIsAdmin: async () => false }));

import { buildAiTaskContext } from "./ai-task-context";

const input = (config: Record<string, unknown>) =>
  ({
    session: {
      id: "session-1",
      userId: "owner-1",
      triggerPayload: { inputs: { parlViewId: "5976131" }, raw: { title: "Senate Estimates" } },
    },
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
  it("joins the step's skills and its tool results, and records the lookups", async () => {
    const context = await buildAiTaskContext(container(true), input({ skillRefs: ["skill-1"] }));

    expect(context).toContain('<skill name="Plain English">');
    expect(context).toContain("<tool_results>");
    expect(context).toContain("- search: 3 hearings");
    expect(runMcpToolPrepass).toHaveBeenCalledWith(
      expect.objectContaining({ stepBrief: "Summarise.", nodeId: "node-ai", sessionId: "session-1" }),
    );
    expect(recordAudit).toHaveBeenCalled();
  });

  it("lets the tools see what the run was started with, so they can look it up", async () => {
    await buildAiTaskContext(container(false), input({}));

    const prepassInput = (runMcpToolPrepass.mock.calls.at(-1) as unknown as [{ gatheredContext: string }])[0];
    expect(prepassInput.gatheredContext).toContain("parlViewId: 5976131");
    expect(prepassInput.gatheredContext).toContain("Senate Estimates");
  });

  it("leaves skills out while the skills flag is off", async () => {
    const context = await buildAiTaskContext(container(false), input({ skillRefs: ["skill-1"] }));

    expect(context).not.toContain("<skills>");
  });
});
