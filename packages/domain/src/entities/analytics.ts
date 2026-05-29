import type { SessionStatus } from "./session";
import type { MessageRole } from "./conversation";
import type { StepOutputField } from "./session-step-output";
import type { TemplateFieldType } from "./template-field";

// ── Raw rows supplied by the analytics repository ────────────────────────────

export interface AnalyticsSessionRow {
  id: string;
  flowId: string;
  flowName: string;
  status: SessionStatus;
  currentNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnalyticsMessageRow {
  sessionId: string;
  stepNodeId: string | null;
  role: MessageRole;
  confidence: number | null;
  createdAt: Date;
}

export interface AnalyticsNode {
  id: string;
  name: string;
  colour: string | null;
}

// ── Overview dashboard DTOs ──────────────────────────────────────────────────

export interface MetricWithDelta {
  value: number;
  previousValue: number;
  deltaPct: number | null;
}

export interface OverviewMetrics {
  activeSessions: MetricWithDelta;
  completions: MetricWithDelta;
  completionRate: MetricWithDelta;
}

export interface SessionActivityPoint {
  date: string;
  started: number;
  completed: number;
}

export interface FlowDistributionSlice {
  flowId: string;
  flowName: string;
  count: number;
}

export interface ConfidenceLifecyclePoint {
  bucket: number;
  positionPct: number;
  averageConfidence: number;
  sampleCount: number;
}

// ── Flow deep-dive DTOs ──────────────────────────────────────────────────────

export interface NodeBreakdownRow {
  nodeId: string;
  nodeName: string;
  colour: string | null;
  sessionsVisited: number;
  averageTurns: number;
  averageDurationSeconds: number;
  averageConfidenceAtCompletion: number | null;
  dropOff: number;
  completionRate: number;
}

export interface FieldValueCount {
  value: string;
  count: number;
}

export interface FieldNumericStats {
  count: number;
  min: number;
  max: number;
  average: number;
}

export interface FieldReportSummary {
  key: string;
  label: string;
  type: TemplateFieldType;
  filledCount: number;
  totalCount: number;
  distribution?: FieldValueCount[];
  numeric?: FieldNumericStats;
}

export interface FieldReportRow {
  sessionId: string;
  nodeId: string;
  createdAt: Date;
  values: Record<string, string>;
}

export interface FieldReport {
  fields: { key: string; label: string; type: TemplateFieldType }[];
  summaries: FieldReportSummary[];
  rows: FieldReportRow[];
}

// ── Pure aggregation helpers ─────────────────────────────────────────────────

const inRange = (date: Date, start: Date, end: Date): boolean =>
  date.getTime() >= start.getTime() && date.getTime() <= end.getTime();

const deltaPct = (value: number, previousValue: number): number | null => {
  if (previousValue === 0) return null;
  return ((value - previousValue) / previousValue) * 100;
};

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

export const computeOverviewMetrics = (
  sessions: AnalyticsSessionRow[],
  periodStart: Date,
  previousPeriodStart: Date,
  now: Date,
): OverviewMetrics => {
  const startedCurrent = sessions.filter((session) => inRange(session.createdAt, periodStart, now));
  const startedPrevious = sessions.filter((session) =>
    inRange(session.createdAt, previousPeriodStart, new Date(periodStart.getTime() - 1)),
  );
  const completedCurrent = sessions.filter(
    (session) => session.status === "complete" && inRange(session.updatedAt, periodStart, now),
  );
  const completedPrevious = sessions.filter(
    (session) =>
      session.status === "complete" &&
      inRange(session.updatedAt, previousPeriodStart, new Date(periodStart.getTime() - 1)),
  );

  const rateCurrent =
    startedCurrent.length === 0 ? 0 : (completedCurrent.length / startedCurrent.length) * 100;
  const ratePrevious =
    startedPrevious.length === 0 ? 0 : (completedPrevious.length / startedPrevious.length) * 100;

  return {
    activeSessions: {
      value: startedCurrent.length,
      previousValue: startedPrevious.length,
      deltaPct: deltaPct(startedCurrent.length, startedPrevious.length),
    },
    completions: {
      value: completedCurrent.length,
      previousValue: completedPrevious.length,
      deltaPct: deltaPct(completedCurrent.length, completedPrevious.length),
    },
    completionRate: {
      value: Math.round(rateCurrent),
      previousValue: Math.round(ratePrevious),
      deltaPct: deltaPct(rateCurrent, ratePrevious),
    },
  };
};

export const computeSessionActivity = (
  sessions: AnalyticsSessionRow[],
  periodStart: Date,
  now: Date,
): SessionActivityPoint[] => {
  const started = new Map<string, number>();
  const completed = new Map<string, number>();

  for (const session of sessions) {
    if (inRange(session.createdAt, periodStart, now)) {
      const key = dayKey(session.createdAt);
      started.set(key, (started.get(key) ?? 0) + 1);
    }
    if (session.status === "complete" && inRange(session.updatedAt, periodStart, now)) {
      const key = dayKey(session.updatedAt);
      completed.set(key, (completed.get(key) ?? 0) + 1);
    }
  }

  const points: SessionActivityPoint[] = [];
  const cursor = new Date(Date.UTC(
    periodStart.getUTCFullYear(),
    periodStart.getUTCMonth(),
    periodStart.getUTCDate(),
  ));
  while (cursor.getTime() <= now.getTime()) {
    const key = dayKey(cursor);
    points.push({ date: key, started: started.get(key) ?? 0, completed: completed.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return points;
};

export const computeFlowDistribution = (
  sessions: AnalyticsSessionRow[],
): FlowDistributionSlice[] => {
  const byFlow = new Map<string, FlowDistributionSlice>();
  for (const session of sessions) {
    const existing = byFlow.get(session.flowId);
    if (existing) {
      existing.count += 1;
    } else {
      byFlow.set(session.flowId, {
        flowId: session.flowId,
        flowName: session.flowName,
        count: 1,
      });
    }
  }
  return [...byFlow.values()].sort((a, b) => b.count - a.count);
};

export const computeConfidenceLifecycle = (
  messages: AnalyticsMessageRow[],
  bucketCount = 10,
): ConfidenceLifecyclePoint[] => {
  const bySession = new Map<string, AnalyticsMessageRow[]>();
  for (const message of messages) {
    if (message.role !== "assistant" || message.confidence === null) continue;
    const list = bySession.get(message.sessionId) ?? [];
    list.push(message);
    bySession.set(message.sessionId, list);
  }

  const sums = new Array<number>(bucketCount).fill(0);
  const counts = new Array<number>(bucketCount).fill(0);

  for (const list of bySession.values()) {
    const ordered = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    ordered.forEach((message, index) => {
      const position = ordered.length === 1 ? 0 : index / (ordered.length - 1);
      const bucket = Math.min(bucketCount - 1, Math.floor(position * bucketCount));
      sums[bucket] = (sums[bucket] ?? 0) + (message.confidence ?? 0);
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    });
  }

  const points: ConfidenceLifecyclePoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const sampleCount = counts[bucket] ?? 0;
    points.push({
      bucket: bucket + 1,
      positionPct: Math.round(((bucket + 1) / bucketCount) * 100),
      averageConfidence: sampleCount === 0 ? 0 : Math.round((sums[bucket] ?? 0) / sampleCount),
      sampleCount,
    });
  }
  return points;
};

export const computeNodeBreakdown = (
  nodes: AnalyticsNode[],
  messages: AnalyticsMessageRow[],
  sessions: AnalyticsSessionRow[],
): NodeBreakdownRow[] => {
  return nodes.map((node) => {
    const nodeMessages = messages.filter((message) => message.stepNodeId === node.id);
    const sessionIds = new Set(nodeMessages.map((message) => message.sessionId));
    const visited = sessionIds.size;

    let totalUserTurns = 0;
    let totalDurationSeconds = 0;
    let durationSessions = 0;
    const completionConfidences: number[] = [];

    for (const sessionId of sessionIds) {
      const sessionMessages = nodeMessages.filter((message) => message.sessionId === sessionId);
      totalUserTurns += sessionMessages.filter((message) => message.role === "user").length;

      const times = sessionMessages.map((message) => message.createdAt.getTime());
      if (times.length > 1) {
        totalDurationSeconds += (Math.max(...times) - Math.min(...times)) / 1000;
        durationSessions += 1;
      }

      const confidences = sessionMessages
        .filter((message) => message.role === "assistant" && message.confidence !== null)
        .map((message) => message.confidence as number);
      if (confidences.length > 0) completionConfidences.push(Math.max(...confidences));
    }

    const stuckHere = sessions.filter(
      (session) => session.currentNodeId === node.id && session.status !== "complete",
    );
    const dropOff = stuckHere.filter((session) => session.status === "abandoned").length;
    const completionRate = visited === 0 ? 0 : ((visited - stuckHere.length) / visited) * 100;

    return {
      nodeId: node.id,
      nodeName: node.name,
      colour: node.colour,
      sessionsVisited: visited,
      averageTurns: visited === 0 ? 0 : Math.round((totalUserTurns / visited) * 10) / 10,
      averageDurationSeconds:
        durationSessions === 0 ? 0 : Math.round(totalDurationSeconds / durationSessions),
      averageConfidenceAtCompletion:
        completionConfidences.length === 0
          ? null
          : Math.round(
              completionConfidences.reduce((sum, value) => sum + value, 0) /
                completionConfidences.length,
            ),
      dropOff,
      completionRate: Math.round(completionRate),
    };
  });
};

interface StepOutputForReport {
  sessionId: string;
  nodeId: string;
  createdAt: Date;
  fields: StepOutputField[];
}

const parseNumeric = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

export const computeFieldReport = (stepOutputs: StepOutputForReport[]): FieldReport => {
  const fieldOrder: { key: string; label: string; type: TemplateFieldType }[] = [];
  const seen = new Set<string>();
  const categoricalKeys = new Set<string>();
  const valuesByKey = new Map<string, string[]>();

  const rows: FieldReportRow[] = stepOutputs.map((output) => {
    const values: Record<string, string> = {};
    for (const field of output.fields) {
      if (!seen.has(field.key)) {
        seen.add(field.key);
        fieldOrder.push({ key: field.key, label: field.label, type: field.type });
      }
      if (field.type === "yesno" || (field.options && field.options.length > 0)) {
        categoricalKeys.add(field.key);
      }
      values[field.key] = field.value;
      const list = valuesByKey.get(field.key) ?? [];
      list.push(field.value);
      valuesByKey.set(field.key, list);
    }
    return {
      sessionId: output.sessionId,
      nodeId: output.nodeId,
      createdAt: output.createdAt,
      values,
    };
  });

  const summaries: FieldReportSummary[] = fieldOrder.map((field) => {
    const allValues = valuesByKey.get(field.key) ?? [];
    const filled = allValues.filter((value) => value.trim() !== "");

    const summary: FieldReportSummary = {
      key: field.key,
      label: field.label,
      type: field.type,
      filledCount: filled.length,
      totalCount: allValues.length,
    };

    if (categoricalKeys.has(field.key)) {
      const counts = new Map<string, number>();
      for (const value of filled) counts.set(value, (counts.get(value) ?? 0) + 1);
      summary.distribution = [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
    }

    if (field.type === "number" || field.type === "currency") {
      const numbers = filled
        .map(parseNumeric)
        .filter((value): value is number => value !== null);
      if (numbers.length > 0) {
        summary.numeric = {
          count: numbers.length,
          min: Math.min(...numbers),
          max: Math.max(...numbers),
          average: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
        };
      }
    }

    return summary;
  });

  return { fields: fieldOrder, summaries, rows };
};
