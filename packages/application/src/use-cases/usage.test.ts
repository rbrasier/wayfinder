import { describe, it, expect } from "vitest";
import {
  type IUsageRepository,
  type NewUsageEvent,
  type Result,
  type UsageEvent,
  type UsageFilter,
  type UsageSummary,
  ok,
} from "@rbrasier/domain";
import { GetUsageSummary, TrackUsage } from "./track-usage";

function makeUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    userId: null,
    conversationId: null,
    purpose: "chat",
    provider: "anthropic",
    model: "claude-3-haiku",
    promptTokens: 100,
    completionTokens: 50,
    systemTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.001,
    metadata: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class InMemoryUsageRepo implements IUsageRepository {
  private events: UsageEvent[] = [];

  async create(input: NewUsageEvent): Promise<Result<UsageEvent>> {
    const event = makeUsageEvent({ ...input });
    this.events.push(event);
    return ok(event);
  }

  async summarize(_filter?: UsageFilter): Promise<Result<UsageSummary[]>> {
    const summary: UsageSummary = {
      provider: "anthropic",
      model: "claude-3-haiku",
      totalPromptTokens: this.events.reduce((s, e) => s + e.promptTokens, 0),
      totalCompletionTokens: this.events.reduce((s, e) => s + e.completionTokens, 0),
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalCostUsd: this.events.reduce((s, e) => s + e.costUsd, 0),
      eventCount: this.events.length,
    };
    return ok(this.events.length ? [summary] : []);
  }
}

describe("TrackUsage", () => {
  it("records a usage event and returns true", async () => {
    const repo = new InMemoryUsageRepo();
    const sut = new TrackUsage(repo);

    const result = await sut.execute({
      purpose: "chat",
      provider: "anthropic",
      model: "claude-3-haiku",
      promptTokens: 100,
      completionTokens: 50,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toBe(true);
  });
});

describe("GetUsageSummary", () => {
  it("returns aggregated usage summary", async () => {
    const repo = new InMemoryUsageRepo();
    await repo.create({
      purpose: "chat",
      provider: "anthropic",
      model: "claude-3-haiku",
      promptTokens: 100,
      completionTokens: 50,
      systemTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    });
    const sut = new GetUsageSummary(repo);

    const result = await sut.execute();

    expect(result.error).toBeUndefined();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.eventCount).toBe(1);
  });
});
