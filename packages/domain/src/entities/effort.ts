import type { SessionStatus } from "./session";
import type { AnalyticsMessageRow, AnalyticsNode } from "./analytics";

// ── Tuning constants ─────────────────────────────────────────────────────────

// A gap longer than this is someone coming back to the work, not attention held
// on it, so it contributes the cap rather than its full span. Without it, wall
// clock counts lunch breaks and overnight pauses as effort.
export const IDLE_CAP_MINUTES = 10;

// Reading the opening prompt before the first reply. Charged once per session so
// a one-message step costs something rather than nothing.
export const FIRST_TOUCH_MINUTES = 2;

// An open session untouched for longer than this is parked, not in progress.
export const STALLED_AFTER_DAYS = 7;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A terminal session has stopped consuming effort, so its saving is final.
// `cancelled` and `abandoned` count alongside `complete`: reaching the point a
// case was dropped still avoided the manual work up to there.
const CONTRIBUTING_STATUSES: readonly SessionStatus[] = ["complete", "abandoned", "cancelled"];

const isContributing = (status: SessionStatus): boolean => CONTRIBUTING_STATUSES.includes(status);

// ── Row shapes ───────────────────────────────────────────────────────────────

export interface EffortSessionRow {
  id: string;
  flowId: string;
  flowName: string;
  status: SessionStatus;
  manualEstimateMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FunnelSessionRow extends EffortSessionRow {
  currentNodeId: string | null;
}

export interface FlowEffortRow {
  flowId: string;
  flowName: string;
  sessions: number;
  completed: number;
  // Null when the flow has no operator estimates at all. Null is not zero: it
  // means "unknown", and the UI must say so rather than render a saving.
  baselineMinutes: number | null;
  avoidedMinutes: number | null;
  medianHandsOnMinutes: number;
  estimatedSessions: number;
}

export interface EffortAvoided {
  totalAvoidedMinutes: number;
  totalHandsOnMinutes: number;
  contributingSessions: number;
  estimatedSessions: number;
  coveragePct: number;
  byFlow: FlowEffortRow[];
}

export interface StepFunnelRow {
  nodeId: string;
  nodeName: string;
  entered: number;
  continued: number;
  abandoned: number;
  stalled: number;
  // Still open and recently worked — neither lost nor through yet.
  inFlight: number;
  medianMinutes: number;
  averageTurns: number;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
};

// Sums the gaps between consecutive messages, capping each so an idle stretch
// stops counting, and adds a fixed charge for reading the opening message.
export const sessioniseHandsOn = (messages: AnalyticsMessageRow[]): number => {
  if (messages.length === 0) return 0;

  const times = messages.map((message) => message.createdAt.getTime()).sort((a, b) => a - b);

  let minutes = FIRST_TOUCH_MINUTES;
  for (let index = 1; index < times.length; index += 1) {
    const gap = (times[index]! - times[index - 1]!) / MS_PER_MINUTE;
    minutes += Math.min(gap, IDLE_CAP_MINUTES);
  }
  return Math.round(minutes);
};

export const computeFlowBaselineMinutes = (estimates: number[]): number | null =>
  median(estimates);

const groupBySession = (messages: AnalyticsMessageRow[]): Map<string, AnalyticsMessageRow[]> => {
  const bySession = new Map<string, AnalyticsMessageRow[]>();
  for (const message of messages) {
    const list = bySession.get(message.sessionId) ?? [];
    list.push(message);
    bySession.set(message.sessionId, list);
  }
  return bySession;
};

export const computeEffortAvoided = (
  sessions: EffortSessionRow[],
  messages: AnalyticsMessageRow[],
): EffortAvoided => {
  const contributing = sessions.filter((session) => isContributing(session.status));
  const bySession = groupBySession(messages);

  const byFlowId = new Map<string, EffortSessionRow[]>();
  for (const session of contributing) {
    const list = byFlowId.get(session.flowId) ?? [];
    list.push(session);
    byFlowId.set(session.flowId, list);
  }

  let totalAvoidedMinutes = 0;
  let totalHandsOnMinutes = 0;
  const rows: FlowEffortRow[] = [];

  for (const [flowId, flowSessions] of byFlowId.entries()) {
    const estimates = flowSessions
      .map((session) => session.manualEstimateMinutes)
      .filter((estimate): estimate is number => estimate !== null);
    const baselineMinutes = computeFlowBaselineMinutes(estimates);

    const handsOnPerSession = flowSessions.map((session) =>
      sessioniseHandsOn(bySession.get(session.id) ?? []),
    );
    const flowHandsOn = handsOnPerSession.reduce((sum, value) => sum + value, 0);
    totalHandsOnMinutes += flowHandsOn;

    // A flow nobody has estimated contributes no saving at all — the honest
    // treatment, since interpolating one would invent the whole figure.
    const avoidedMinutes =
      baselineMinutes === null
        ? null
        : handsOnPerSession.reduce((sum, handsOn) => sum + Math.max(baselineMinutes - handsOn, 0), 0);

    if (avoidedMinutes !== null) totalAvoidedMinutes += avoidedMinutes;

    rows.push({
      flowId,
      flowName: flowSessions[0]!.flowName,
      sessions: flowSessions.length,
      completed: flowSessions.filter((session) => session.status === "complete").length,
      baselineMinutes,
      avoidedMinutes,
      medianHandsOnMinutes: median(handsOnPerSession) ?? 0,
      estimatedSessions: estimates.length,
    });
  }

  // Ranked by what each flow saved, because how often a flow ran says nothing
  // about whether it was worth running. A flow with no baseline sorts last.
  rows.sort((a, b) => (b.avoidedMinutes ?? -1) - (a.avoidedMinutes ?? -1));

  const estimatedSessions = contributing.filter(
    (session) => session.manualEstimateMinutes !== null,
  ).length;

  return {
    totalAvoidedMinutes,
    totalHandsOnMinutes,
    contributingSessions: contributing.length,
    estimatedSessions,
    coveragePct:
      contributing.length === 0
        ? 0
        : Math.round((estimatedSessions / contributing.length) * 100),
    byFlow: rows,
  };
};

export const computeStepFunnel = (
  nodes: AnalyticsNode[],
  messages: AnalyticsMessageRow[],
  sessions: FunnelSessionRow[],
  now: Date,
): StepFunnelRow[] => {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  return nodes.map((node) => {
    const nodeMessages = messages.filter((message) => message.stepNodeId === node.id);
    const sessionIds = [...new Set(nodeMessages.map((message) => message.sessionId))];

    let continued = 0;
    let abandoned = 0;
    let stalled = 0;
    let inFlight = 0;
    let totalUserTurns = 0;
    const durations: number[] = [];

    for (const sessionId of sessionIds) {
      const ownMessages = nodeMessages.filter((message) => message.sessionId === sessionId);
      durations.push(sessioniseHandsOn(ownMessages));
      totalUserTurns += ownMessages.filter((message) => message.role === "user").length;

      const session = sessionById.get(sessionId);
      if (!session) {
        continued += 1;
        continue;
      }

      // Resting here means the session stopped on this step. Anything else got
      // past it, whatever happened later.
      const restingHere = session.currentNodeId === node.id;
      if (!restingHere || session.status === "complete") {
        continued += 1;
        continue;
      }

      if (session.status === "abandoned" || session.status === "cancelled") {
        abandoned += 1;
        continue;
      }

      const idleDays = (now.getTime() - session.updatedAt.getTime()) / MS_PER_DAY;
      if (idleDays > STALLED_AFTER_DAYS) {
        stalled += 1;
        continue;
      }
      inFlight += 1;
    }

    return {
      nodeId: node.id,
      nodeName: node.name,
      entered: sessionIds.length,
      continued,
      abandoned,
      stalled,
      inFlight,
      medianMinutes: median(durations) ?? 0,
      averageTurns:
        sessionIds.length === 0
          ? 0
          : Math.round((totalUserTurns / sessionIds.length) * 10) / 10,
    };
  });
};
