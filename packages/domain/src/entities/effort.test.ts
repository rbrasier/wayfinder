import { describe, it, expect } from "vitest";
import {
  IDLE_CAP_MINUTES,
  FIRST_TOUCH_MINUTES,
  STALLED_AFTER_DAYS,
  computeEffortAvoided,
  computeFlowBaselineMinutes,
  computeStepFunnel,
  sessioniseHandsOn,
  type EffortSessionRow,
  type FunnelSessionRow,
} from "./effort";
import type { AnalyticsMessageRow, AnalyticsNode } from "./analytics";

const at = (iso: string): Date => new Date(iso);

const message = (overrides: Partial<AnalyticsMessageRow>): AnalyticsMessageRow => ({
  sessionId: "s1",
  stepNodeId: "n1",
  role: "user",
  confidence: null,
  createdAt: at("2026-08-01T09:00:00Z"),
  ...overrides,
});

const effortSession = (overrides: Partial<EffortSessionRow>): EffortSessionRow => ({
  id: "s1",
  flowId: "f1",
  flowName: "Flow One",
  status: "complete",
  manualEstimateMinutes: null,
  createdAt: at("2026-08-01T09:00:00Z"),
  updatedAt: at("2026-08-01T10:00:00Z"),
  ...overrides,
});

describe("sessioniseHandsOn", () => {
  it("sums the gaps between consecutive messages", () => {
    const minutes = sessioniseHandsOn([
      message({ createdAt: at("2026-08-01T09:00:00Z") }),
      message({ createdAt: at("2026-08-01T09:03:00Z") }),
      message({ createdAt: at("2026-08-01T09:07:00Z") }),
    ]);

    // 3 + 4 minutes of gaps, plus the opening read.
    expect(minutes).toBe(7 + FIRST_TOUCH_MINUTES);
  });

  it("caps a gap at the idle threshold so an overnight pause is not counted", () => {
    const overnight = sessioniseHandsOn([
      message({ createdAt: at("2026-08-01T09:00:00Z") }),
      message({ createdAt: at("2026-08-02T09:00:00Z") }),
    ]);

    expect(overnight).toBe(IDLE_CAP_MINUTES + FIRST_TOUCH_MINUTES);
  });

  it("charges only the opening read for a single-message session", () => {
    expect(sessioniseHandsOn([message({})])).toBe(FIRST_TOUCH_MINUTES);
  });

  it("returns zero for a session with no messages", () => {
    expect(sessioniseHandsOn([])).toBe(0);
  });

  it("orders messages by time before measuring, so input order does not matter", () => {
    const ordered = sessioniseHandsOn([
      message({ createdAt: at("2026-08-01T09:00:00Z") }),
      message({ createdAt: at("2026-08-01T09:05:00Z") }),
    ]);
    const shuffled = sessioniseHandsOn([
      message({ createdAt: at("2026-08-01T09:05:00Z") }),
      message({ createdAt: at("2026-08-01T09:00:00Z") }),
    ]);

    expect(shuffled).toBe(ordered);
  });
});

describe("computeFlowBaselineMinutes", () => {
  it("takes the median so one extreme answer cannot distort it", () => {
    expect(computeFlowBaselineMinutes([60, 70, 80, 90, 100_000])).toBe(80);
  });

  it("averages the middle pair for an even number of estimates", () => {
    expect(computeFlowBaselineMinutes([60, 80, 100, 120])).toBe(90);
  });

  it("has no baseline when nothing has been estimated", () => {
    expect(computeFlowBaselineMinutes([])).toBeNull();
  });
});

describe("computeEffortAvoided", () => {
  const messagesFor = (sessionId: string, minutes: number): AnalyticsMessageRow[] => [
    message({ sessionId, createdAt: at("2026-08-01T09:00:00Z") }),
    message({ sessionId, createdAt: new Date(at("2026-08-01T09:00:00Z").getTime() + minutes * 60_000) }),
  ];

  it("credits the baseline less the measured hands-on time", () => {
    const gapMinutes = 6; // deliberately under the idle cap, so nothing is trimmed
    const result = computeEffortAvoided(
      [effortSession({ id: "s1", manualEstimateMinutes: 240 })],
      messagesFor("s1", gapMinutes),
    );

    expect(result.totalAvoidedMinutes).toBe(240 - (gapMinutes + FIRST_TOUCH_MINUTES));
  });

  it("subtracts only the capped hands-on time when a session sat idle mid-case", () => {
    const result = computeEffortAvoided(
      [effortSession({ id: "s1", manualEstimateMinutes: 240 })],
      messagesFor("s1", 20),
    );

    // The 20-minute gap is idle beyond the cap, so it costs the cap, not its span.
    expect(result.totalAvoidedMinutes).toBe(240 - (IDLE_CAP_MINUTES + FIRST_TOUCH_MINUTES));
  });

  it("counts abandoned and cancelled sessions — reaching the drop point still avoided the work", () => {
    const result = computeEffortAvoided(
      [
        effortSession({ id: "s1", status: "abandoned", manualEstimateMinutes: 120 }),
        effortSession({ id: "s2", status: "cancelled", manualEstimateMinutes: 120 }),
      ],
      [...messagesFor("s1", 10), ...messagesFor("s2", 10)],
    );

    expect(result.contributingSessions).toBe(2);
    expect(result.totalAvoidedMinutes).toBeGreaterThan(0);
  });

  it("ignores active sessions, which have avoided nothing yet", () => {
    const result = computeEffortAvoided(
      [effortSession({ id: "s1", status: "active", manualEstimateMinutes: 120 })],
      messagesFor("s1", 10),
    );

    expect(result.contributingSessions).toBe(0);
    expect(result.totalAvoidedMinutes).toBe(0);
  });

  it("never goes negative when a session took longer than the manual estimate", () => {
    const result = computeEffortAvoided(
      [effortSession({ id: "s1", manualEstimateMinutes: 5 })],
      messagesFor("s1", 600),
    );

    expect(result.totalAvoidedMinutes).toBe(0);
  });

  it("excludes a flow with no estimates rather than crediting it zero", () => {
    const result = computeEffortAvoided(
      [effortSession({ id: "s1", flowId: "f1", manualEstimateMinutes: null })],
      messagesFor("s1", 10),
    );

    const flow = result.byFlow.find((row) => row.flowId === "f1");
    expect(flow?.baselineMinutes).toBeNull();
    expect(flow?.avoidedMinutes).toBeNull();
  });

  it("applies one flow's median baseline to its sessions that were never estimated", () => {
    const result = computeEffortAvoided(
      [
        effortSession({ id: "s1", manualEstimateMinutes: 200 }),
        effortSession({ id: "s2", manualEstimateMinutes: 200 }),
        effortSession({ id: "s3", manualEstimateMinutes: null }),
      ],
      [...messagesFor("s1", 10), ...messagesFor("s2", 10), ...messagesFor("s3", 10)],
    );

    expect(result.byFlow[0]?.baselineMinutes).toBe(200);
    expect(result.contributingSessions).toBe(3);
  });

  it("reports coverage as the share of contributing sessions carrying an estimate", () => {
    const result = computeEffortAvoided(
      [
        effortSession({ id: "s1", manualEstimateMinutes: 120 }),
        effortSession({ id: "s2", manualEstimateMinutes: null }),
        effortSession({ id: "s3", manualEstimateMinutes: null }),
        effortSession({ id: "s4", manualEstimateMinutes: 120 }),
      ],
      [],
    );

    expect(result.estimatedSessions).toBe(2);
    expect(result.contributingSessions).toBe(4);
    expect(result.coveragePct).toBe(50);
  });

  it("separates flows so each carries its own baseline", () => {
    const result = computeEffortAvoided(
      [
        effortSession({ id: "s1", flowId: "f1", flowName: "One", manualEstimateMinutes: 60 }),
        effortSession({ id: "s2", flowId: "f2", flowName: "Two", manualEstimateMinutes: 600 }),
      ],
      [],
    );

    expect(result.byFlow.find((row) => row.flowId === "f1")?.baselineMinutes).toBe(60);
    expect(result.byFlow.find((row) => row.flowId === "f2")?.baselineMinutes).toBe(600);
  });

  it("ranks flows by the effort they avoided, not by how often they ran", () => {
    const result = computeEffortAvoided(
      [
        effortSession({ id: "a1", flowId: "busy", flowName: "Busy", manualEstimateMinutes: 10 }),
        effortSession({ id: "a2", flowId: "busy", flowName: "Busy", manualEstimateMinutes: 10 }),
        effortSession({ id: "a3", flowId: "busy", flowName: "Busy", manualEstimateMinutes: 10 }),
        effortSession({ id: "b1", flowId: "slow", flowName: "Slow", manualEstimateMinutes: 600 }),
      ],
      [],
    );

    expect(result.byFlow[0]?.flowId).toBe("slow");
  });
});

describe("computeStepFunnel", () => {
  const nodes: AnalyticsNode[] = [
    { id: "n1", name: "Capture", colour: null },
    { id: "n2", name: "Checks", colour: null },
  ];

  const now = at("2026-08-20T00:00:00Z");
  const funnelSession = (overrides: Partial<FunnelSessionRow>): FunnelSessionRow => ({
    id: "s1",
    flowId: "f1",
    flowName: "Flow One",
    status: "active",
    currentNodeId: null,
    manualEstimateMinutes: null,
    createdAt: at("2026-08-01T09:00:00Z"),
    updatedAt: at("2026-08-19T00:00:00Z"),
    ...overrides,
  });

  it("counts a session that reached a later step as continued", () => {
    const rows = computeStepFunnel(
      nodes,
      [message({ sessionId: "s1", stepNodeId: "n1" }), message({ sessionId: "s1", stepNodeId: "n2" })],
      [funnelSession({ id: "s1", currentNodeId: "n2" })],
      now,
    );

    expect(rows[0]?.entered).toBe(1);
    expect(rows[0]?.continued).toBe(1);
    expect(rows[0]?.abandoned).toBe(0);
    expect(rows[0]?.stalled).toBe(0);
  });

  it("counts an abandoned session resting on the step as abandoned, never stalled", () => {
    const rows = computeStepFunnel(
      nodes,
      [message({ sessionId: "s1", stepNodeId: "n1" })],
      [funnelSession({ id: "s1", status: "abandoned", currentNodeId: "n1" })],
      now,
    );

    expect(rows[0]?.abandoned).toBe(1);
    expect(rows[0]?.stalled).toBe(0);
  });

  it("counts an active session untouched beyond the threshold as stalled", () => {
    const rows = computeStepFunnel(
      nodes,
      [message({ sessionId: "s1", stepNodeId: "n1" })],
      [
        funnelSession({
          id: "s1",
          status: "active",
          currentNodeId: "n1",
          updatedAt: new Date(now.getTime() - (STALLED_AFTER_DAYS + 1) * 24 * 60 * 60 * 1000),
        }),
      ],
      now,
    );

    expect(rows[0]?.stalled).toBe(1);
    expect(rows[0]?.abandoned).toBe(0);
  });

  it("does not call a recently touched active session stalled", () => {
    const rows = computeStepFunnel(
      nodes,
      [message({ sessionId: "s1", stepNodeId: "n1" })],
      [
        funnelSession({
          id: "s1",
          status: "active",
          currentNodeId: "n1",
          updatedAt: new Date(now.getTime() - 60 * 60 * 1000),
        }),
      ],
      now,
    );

    expect(rows[0]?.stalled).toBe(0);
    expect(rows[0]?.inFlight).toBe(1);
  });

  it("reconciles: entered always equals continued plus abandoned plus stalled plus in-flight", () => {
    const sessions = [
      funnelSession({ id: "s1", status: "complete", currentNodeId: null }),
      funnelSession({ id: "s2", status: "abandoned", currentNodeId: "n1" }),
      funnelSession({
        id: "s3",
        status: "active",
        currentNodeId: "n1",
        updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      }),
      funnelSession({ id: "s4", status: "active", currentNodeId: "n1", updatedAt: now }),
    ];
    const messages = sessions.map((session) => message({ sessionId: session.id, stepNodeId: "n1" }));

    const rows = computeStepFunnel(nodes, messages, sessions, now);
    const row = rows[0]!;

    expect(row.entered).toBe(row.continued + row.abandoned + row.stalled + row.inFlight);
  });

  it("reports the median step time, so one long pause does not move it", () => {
    const start = at("2026-08-01T09:00:00Z");
    const span = (sessionId: string, minutes: number): AnalyticsMessageRow[] => [
      message({ sessionId, stepNodeId: "n1", createdAt: start }),
      message({ sessionId, stepNodeId: "n1", createdAt: new Date(start.getTime() + minutes * 60_000) }),
    ];

    const rows = computeStepFunnel(
      nodes,
      [...span("s1", 5), ...span("s2", 6), ...span("s3", 600)],
      [
        funnelSession({ id: "s1", status: "complete" }),
        funnelSession({ id: "s2", status: "complete" }),
        funnelSession({ id: "s3", status: "complete" }),
      ],
      now,
    );

    // The mean would be dragged past 200; the median stays with the typical case.
    expect(rows[0]?.medianMinutes).toBe(6 + FIRST_TOUCH_MINUTES);
  });

  it("includes a one-message step instead of dropping it from the average", () => {
    const rows = computeStepFunnel(
      nodes,
      [message({ sessionId: "s1", stepNodeId: "n1" })],
      [funnelSession({ id: "s1", status: "complete" })],
      now,
    );

    expect(rows[0]?.medianMinutes).toBe(FIRST_TOUCH_MINUTES);
  });

  it("keeps steps in the order they were supplied, which is graph order", () => {
    const rows = computeStepFunnel(nodes, [], [], now);
    expect(rows.map((row) => row.nodeId)).toEqual(["n1", "n2"]);
  });
});
