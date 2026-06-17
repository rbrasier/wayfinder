import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok, type IUsageRepository, type TokenUsage } from "@rbrasier/domain";
import { recordTokenUsage } from "./usage-tracking-adapter";

const createMockRepo = (
  createImpl?: IUsageRepository["create"],
): IUsageRepository => ({
  create: createImpl ?? vi.fn().mockResolvedValue(ok({ id: "usage-1" })),
  summarize: vi.fn(),
  summarizeBy: vi.fn(),
});

const baseUsage: TokenUsage = {
  promptTokens: 100,
  completionTokens: 50,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

describe("recordTokenUsage", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("logs an error to console when repo.create fails", async () => {
    const repo = createMockRepo(
      vi.fn().mockResolvedValue(err({ code: "INFRA_FAILURE", message: "FK violation" })),
    );

    recordTokenUsage(
      repo,
      { purpose: "chat-turn", provider: "anthropic" },
      baseUsage,
    );

    // recordTokenUsage is fire-and-forget, so flush microtasks
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    const output = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("usage");
  });

  it("logs an error to console when repo.create throws", async () => {
    const repo = createMockRepo(
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );

    recordTokenUsage(
      repo,
      { purpose: "chat-turn", provider: "anthropic" },
      baseUsage,
    );

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
    const output = consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("connection refused");
  });
});

describe("estimateCost via recordTokenUsage", () => {
  it("calculates non-zero cost for dated model name claude-sonnet-4-20250514", async () => {
    const createFn = vi.fn().mockResolvedValue(ok({ id: "usage-1" }));
    const repo = createMockRepo(createFn);

    recordTokenUsage(
      repo,
      { purpose: "document-generation", model: "claude-sonnet-4-20250514", provider: "anthropic" },
      { promptTokens: 1000, completionTokens: 200, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );

    await vi.waitFor(() => {
      expect(createFn).toHaveBeenCalled();
    });

    const call = createFn.mock.calls[0]![0];
    expect(call.costUsd).toBeGreaterThan(0);
  });

  it("calculates non-zero cost for short model name claude-sonnet-4-6", async () => {
    const createFn = vi.fn().mockResolvedValue(ok({ id: "usage-1" }));
    const repo = createMockRepo(createFn);

    recordTokenUsage(
      repo,
      { purpose: "chat", model: "claude-sonnet-4-6", provider: "anthropic" },
      { promptTokens: 1000, completionTokens: 200, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );

    await vi.waitFor(() => {
      expect(createFn).toHaveBeenCalled();
    });

    const call = createFn.mock.calls[0]![0];
    expect(call.costUsd).toBeGreaterThan(0);
  });

  it("records flow_id and session_id when supplied", async () => {
    const createFn = vi.fn().mockResolvedValue(ok({ id: "usage-1" }));
    const repo = createMockRepo(createFn);

    recordTokenUsage(
      repo,
      {
        purpose: "chat-turn",
        provider: "anthropic",
        userId: "user-1",
        flowId: "flow-1",
        sessionId: "session-1",
      },
      { promptTokens: 10, completionTokens: 5, systemTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    );

    await vi.waitFor(() => {
      expect(createFn).toHaveBeenCalled();
    });

    const call = createFn.mock.calls[0]![0];
    expect(call.flowId).toBe("flow-1");
    expect(call.sessionId).toBe("session-1");
  });

  it("defaults flow_id and session_id to null when omitted", async () => {
    const createFn = vi.fn().mockResolvedValue(ok({ id: "usage-1" }));
    const repo = createMockRepo(createFn);

    recordTokenUsage(repo, { purpose: "chat", provider: "anthropic" }, baseUsage);

    await vi.waitFor(() => {
      expect(createFn).toHaveBeenCalled();
    });

    const call = createFn.mock.calls[0]![0];
    expect(call.flowId).toBeNull();
    expect(call.sessionId).toBeNull();
  });
});
