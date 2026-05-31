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
  const nodeIntake = { id: "n1", name: "Intake" };
  const nodeApproval = { id: "n2", name: "Approval" };
  const sessionS1 = { id: "s1", status: "complete" as const, createdAt: new Date("2026-05-20T00:00:00Z") };
  const sessionS2 = { id: "s2", status: "active" as const, createdAt: new Date("2026-05-21T00:00:00Z") };

  it("merges multiple step outputs for the same session into one row", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [{ key: "vendor", label: "Vendor Name", type: "text", value: "Acme" }],
        },
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T02:00:00Z"),
          fields: [{ key: "approved", label: "Approved", type: "yesno", value: "Yes" }],
        },
      ],
      [nodeIntake, nodeApproval],
      [sessionS1],
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.sessionId).toBe("s1");
    expect(report.rows[0]?.status).toBe("complete");
    expect(report.rows[0]?.startedAt).toEqual(new Date("2026-05-20T00:00:00Z"));
    expect(report.rows[0]?.values["n1:vendor"]).toBe("Acme");
    expect(report.rows[0]?.values["n2:approved"]).toBe("Yes");
    expect(report.columns).toHaveLength(2);
    expect(report.columns[0]?.nodeId).toBe("n1");
    expect(report.columns[0]?.nodeName).toBe("Intake");
    expect(report.columns[1]?.nodeName).toBe("Approval");
  });

  it("excludes narrative fields from columns and rows but keeps section gates", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [
            { key: "vendor", label: "Vendor Name", type: "text", value: "Acme" },
            { key: "background", label: "Background", type: "narrative", value: "Three long paragraphs…" },
            { key: "risk_section", label: "Risk Section", type: "section", value: "Yes" },
          ],
        },
      ],
      [nodeIntake],
      [sessionS1],
    );

    const columnKeys = report.columns.map((column) => column.columnKey);
    expect(columnKeys).toContain("n1:vendor");
    expect(columnKeys).toContain("n1:risk_section");
    expect(columnKeys).not.toContain("n1:background");
    expect(report.rows[0]?.values["n1:background"]).toBeUndefined();
    expect(report.rows[0]?.values["n1:risk_section"]).toBe("Yes");
  });

  it("produces one column per distinct nodeId+fieldKey combination when two nodes share a key", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "vendor", label: "Vendor Name", type: "text", value: "Acme" }],
        },
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "vendor", label: "Vendor Name", type: "text", value: "Buildco" }],
        },
      ],
      [nodeIntake, nodeApproval],
      [sessionS1],
    );

    expect(report.columns).toHaveLength(2);
    expect(report.columns[0]?.columnKey).toBe("n1:vendor");
    expect(report.columns[1]?.columnKey).toBe("n2:vendor");
    expect(report.rows[0]?.values["n1:vendor"]).toBe("Acme");
    expect(report.rows[0]?.values["n2:vendor"]).toBe("Buildco");
  });

  it("uses session status and startedAt from the sessions list", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s2",
          nodeId: "n1",
          createdAt: new Date("2026-05-21T01:00:00Z"),
          fields: [{ key: "fee", label: "Fee", type: "currency", value: "$500.00" }],
        },
      ],
      [nodeIntake],
      [sessionS2],
    );

    expect(report.rows[0]?.status).toBe("active");
    expect(report.rows[0]?.startedAt).toEqual(new Date("2026-05-21T00:00:00Z"));
  });

  it("returns empty columns and rows when there are no step outputs", () => {
    const report = computeFieldReport([], [nodeIntake], [sessionS1, sessionS2]);

    expect(report.rows).toHaveLength(0);
    expect(report.columns).toHaveLength(0);
  });

  it("produces one row per session even across two separate sessions", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [{ key: "fee", label: "Fee", type: "currency", value: "$1,200.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n1",
          createdAt: new Date("2026-05-21T01:00:00Z"),
          fields: [{ key: "fee", label: "Fee", type: "currency", value: "$800.00" }],
        },
      ],
      [nodeIntake],
      [sessionS1, sessionS2],
    );

    expect(report.rows).toHaveLength(2);
    expect(report.columns).toHaveLength(1);
    expect(report.columns[0]?.columnKey).toBe("n1:fee");
    // rows are sorted descending by startedAt — s2 (2026-05-21) comes first
    expect(report.rows[0]?.values["n1:fee"]).toBe("$800.00");
    expect(report.rows[1]?.values["n1:fee"]).toBe("$1,200.00");
  });
});
