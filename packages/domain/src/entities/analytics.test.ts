import { describe, it, expect } from "vitest";
import {
  computeConfidenceLifecycle,
  computeFieldReport,
  computeFlowDistribution,
  computeNodeBreakdown,
  computeOverviewMetrics,
  computeSessionActivity,
  type AnalyticsMessageRow,
  type AnalyticsNode,
  type AnalyticsSessionRow,
} from "./analytics";

const session = (overrides: Partial<AnalyticsSessionRow>): AnalyticsSessionRow => ({
  id: "s1",
  flowId: "f1",
  flowName: "Flow One",
  status: "active",
  currentNodeId: null,
  createdAt: new Date("2026-05-20T00:00:00Z"),
  updatedAt: new Date("2026-05-20T00:00:00Z"),
  ...overrides,
});

const now = new Date("2026-05-29T00:00:00Z");
const periodStart = new Date("2026-05-22T00:00:00Z");
const previousPeriodStart = new Date("2026-05-15T00:00:00Z");

describe("computeOverviewMetrics", () => {
  it("counts started and completed sessions for the current vs previous period", () => {
    const sessions = [
      session({ id: "a", createdAt: new Date("2026-05-23T00:00:00Z") }),
      session({ id: "b", createdAt: new Date("2026-05-24T00:00:00Z"), status: "complete", updatedAt: new Date("2026-05-25T00:00:00Z") }),
      session({ id: "c", createdAt: new Date("2026-05-17T00:00:00Z") }),
    ];

    const metrics = computeOverviewMetrics(sessions, periodStart, previousPeriodStart, now);

    expect(metrics.activeSessions.value).toBe(2);
    expect(metrics.activeSessions.previousValue).toBe(1);
    expect(metrics.completions.value).toBe(1);
    expect(metrics.completionRate.value).toBe(50);
  });

  it("returns a null delta when the previous period had nothing", () => {
    const sessions = [session({ createdAt: new Date("2026-05-23T00:00:00Z") })];
    const metrics = computeOverviewMetrics(sessions, periodStart, previousPeriodStart, now);
    expect(metrics.activeSessions.deltaPct).toBeNull();
  });
});

describe("computeSessionActivity", () => {
  it("produces one point per day with started and completed counts", () => {
    const sessions = [
      session({ createdAt: new Date("2026-05-23T09:00:00Z") }),
      session({ createdAt: new Date("2026-05-23T11:00:00Z"), status: "complete", updatedAt: new Date("2026-05-24T10:00:00Z") }),
    ];

    const points = computeSessionActivity(sessions, periodStart, now);

    expect(points).toHaveLength(8);
    const may23 = points.find((point) => point.date === "2026-05-23");
    const may24 = points.find((point) => point.date === "2026-05-24");
    expect(may23?.started).toBe(2);
    expect(may24?.completed).toBe(1);
  });
});

describe("computeFlowDistribution", () => {
  it("groups sessions by flow and sorts by count descending", () => {
    const sessions = [
      session({ flowId: "f1", flowName: "One" }),
      session({ flowId: "f2", flowName: "Two" }),
      session({ flowId: "f2", flowName: "Two" }),
    ];

    const distribution = computeFlowDistribution(sessions);

    expect(distribution[0]).toEqual({ flowId: "f2", flowName: "Two", count: 2 });
    expect(distribution[1]).toEqual({ flowId: "f1", flowName: "One", count: 1 });
  });
});

describe("computeConfidenceLifecycle", () => {
  it("averages assistant confidence across normalised session positions", () => {
    const messages: AnalyticsMessageRow[] = [
      { sessionId: "s1", stepNodeId: "n1", role: "assistant", confidence: 20, createdAt: new Date("2026-05-20T00:00:00Z") },
      { sessionId: "s1", stepNodeId: "n1", role: "assistant", confidence: 100, createdAt: new Date("2026-05-20T01:00:00Z") },
    ];

    const points = computeConfidenceLifecycle(messages, 10);

    expect(points).toHaveLength(10);
    expect(points[0]?.averageConfidence).toBe(20);
    expect(points[9]?.averageConfidence).toBe(100);
  });

  it("ignores user messages and null confidences", () => {
    const messages: AnalyticsMessageRow[] = [
      { sessionId: "s1", stepNodeId: null, role: "user", confidence: null, createdAt: new Date() },
    ];
    const points = computeConfidenceLifecycle(messages, 5);
    expect(points.every((point) => point.sampleCount === 0)).toBe(true);
  });
});

describe("computeNodeBreakdown", () => {
  const nodes: AnalyticsNode[] = [
    { id: "n1", name: "Intake", colour: null },
    { id: "n2", name: "Draft", colour: "#fff" },
  ];

  it("computes turns, completion rate and drop-off per node", () => {
    const messages: AnalyticsMessageRow[] = [
      { sessionId: "s1", stepNodeId: "n1", role: "user", confidence: null, createdAt: new Date("2026-05-20T00:00:00Z") },
      { sessionId: "s1", stepNodeId: "n1", role: "assistant", confidence: 90, createdAt: new Date("2026-05-20T00:05:00Z") },
      { sessionId: "s2", stepNodeId: "n2", role: "user", confidence: null, createdAt: new Date("2026-05-20T00:00:00Z") },
    ];
    const sessions = [
      session({ id: "s1", status: "complete", currentNodeId: "n2" }),
      session({ id: "s2", status: "abandoned", currentNodeId: "n2" }),
    ];

    const breakdown = computeNodeBreakdown(nodes, messages, sessions);

    const intake = breakdown.find((row) => row.nodeId === "n1");
    const draft = breakdown.find((row) => row.nodeId === "n2");
    expect(intake?.sessionsVisited).toBe(1);
    expect(intake?.averageTurns).toBe(1);
    expect(intake?.averageConfidenceAtCompletion).toBe(90);
    expect(intake?.completionRate).toBe(100);
    expect(draft?.dropOff).toBe(1);
    expect(draft?.completionRate).toBe(0);
  });
});

describe("computeFieldReport", () => {
  it("aggregates distributions for enum fields and numeric stats for currency", () => {
    const report = computeFieldReport([
      {
        sessionId: "s1",
        nodeId: "n1",
        createdAt: new Date("2026-05-20T00:00:00Z"),
        fields: [
          { key: "status", label: "Status", type: "text", options: ["Approved", "Rejected"], value: "Approved" },
          { key: "fee", label: "Fee", type: "currency", value: "$1,200.00" },
        ],
      },
      {
        sessionId: "s2",
        nodeId: "n1",
        createdAt: new Date("2026-05-21T00:00:00Z"),
        fields: [
          { key: "status", label: "Status", type: "text", options: ["Approved", "Rejected"], value: "Approved" },
          { key: "fee", label: "Fee", type: "currency", value: "$800.00" },
        ],
      },
    ]);

    expect(report.fields.map((field) => field.key)).toEqual(["status", "fee"]);
    expect(report.rows).toHaveLength(2);

    const status = report.summaries.find((summary) => summary.key === "status");
    expect(status?.distribution).toEqual([{ value: "Approved", count: 2 }]);

    const fee = report.summaries.find((summary) => summary.key === "fee");
    expect(fee?.numeric).toEqual({ count: 2, min: 800, max: 1200, average: 1000 });
  });

  it("tracks fill rate for free-text fields", () => {
    const report = computeFieldReport([
      {
        sessionId: "s1",
        nodeId: "n1",
        createdAt: new Date(),
        fields: [{ key: "notes", label: "Notes", type: "text", value: "" }],
      },
      {
        sessionId: "s2",
        nodeId: "n1",
        createdAt: new Date(),
        fields: [{ key: "notes", label: "Notes", type: "text", value: "Hello" }],
      },
    ]);

    const notes = report.summaries.find((summary) => summary.key === "notes");
    expect(notes?.filledCount).toBe(1);
    expect(notes?.totalCount).toBe(2);
    expect(notes?.distribution).toBeUndefined();
  });
});
