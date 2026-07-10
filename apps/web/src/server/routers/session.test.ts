import { describe, expect, it } from "vitest";
import type { Session } from "@rbrasier/domain";
import { buildSessionListEntry, sessionListPageInputSchema } from "./session";

const baseSession: Session = {
  id: "session-1",
  flowId: "flow-1",
  userId: "user-1",
  status: "active",
  title: "Onboarding",
  currentNodeId: "node-2",
  graphCheckpoint: null,
  pendingExecutions: {},
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
} as Session;

const graph = { nodeIds: ["node-1", "node-2", "node-3"] };

describe("buildSessionListEntry", () => {
  it("returns a null stepInfo when the flow graph is missing", () => {
    const entry = buildSessionListEntry(baseSession, undefined, undefined);

    expect(entry.stepInfo).toBeNull();
    expect(entry.lastMessage).toBeNull();
  });

  it("returns a null stepInfo when the flow graph has no nodes", () => {
    const entry = buildSessionListEntry(baseSession, { nodeIds: [] }, undefined);

    expect(entry.stepInfo).toBeNull();
  });

  it("maps the current node to a 1-based step index and total steps", () => {
    const entry = buildSessionListEntry(baseSession, graph, undefined);

    expect(entry.stepInfo).toMatchObject({ currentIndex: 2, totalSteps: 3 });
  });

  it("reports a zero current index when the current node is not in the graph", () => {
    const entry = buildSessionListEntry(
      { ...baseSession, currentNodeId: "node-unknown" },
      graph,
      undefined,
    );

    expect(entry.stepInfo?.currentIndex).toBe(0);
  });

  it("counts completed steps above threshold but excludes the current node", () => {
    const entry = buildSessionListEntry(baseSession, graph, {
      sessionId: baseSession.id,
      lastAssistantContent: "hello",
      // node-1 is done (>=90); node-2 is the current node so it never counts;
      // node-3 is below threshold.
      bestConfidenceByStep: { "node-1": 95, "node-2": 99, "node-3": 40 },
    });

    expect(entry.stepInfo?.completedSteps).toBe(1);
    expect(entry.lastMessage).toBe("hello");
    expect(entry.stepInfo?.currentConfidence).toBe(99);
  });

  it("treats a complete session as all steps done with zero current confidence", () => {
    const entry = buildSessionListEntry({ ...baseSession, status: "complete" }, graph, {
      sessionId: baseSession.id,
      lastAssistantContent: null,
      bestConfidenceByStep: { "node-1": 95 },
    });

    expect(entry.stepInfo?.completedSteps).toBe(3);
    expect(entry.stepInfo?.currentConfidence).toBe(0);
  });
});

describe("sessionListPageInputSchema", () => {
  it("defaults the limit to 20 when omitted", () => {
    const parsed = sessionListPageInputSchema.parse({});

    expect(parsed.limit).toBe(20);
  });

  it("accepts a null cursor for the first page and a string cursor for later pages", () => {
    expect(sessionListPageInputSchema.parse({ cursor: null }).cursor).toBeNull();
    expect(sessionListPageInputSchema.parse({ cursor: "abc" }).cursor).toBe("abc");
  });

  it("rejects a limit outside the 1..50 range", () => {
    expect(sessionListPageInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(sessionListPageInputSchema.safeParse({ limit: 51 }).success).toBe(false);
  });
});
