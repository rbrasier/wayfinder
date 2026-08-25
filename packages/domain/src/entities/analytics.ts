import type { SessionStatus } from "./session";
import type { MessageRole } from "./conversation";
import type { StepOutputField } from "./session-step-output";
import type { TemplateFieldType } from "./template-field";
import { computeForkSiblingGroups, type FlowGraphEdge } from "./flow-graph";
import type { FlowNodeType } from "./flow-node";
import { aggregateConfidence, type ExtractionRecord } from "./extraction-record";

export const parseNumeric = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

// ── Raw rows supplied by the analytics repository ────────────────────────────

export interface AnalyticsSessionRow {
  id: string;
  flowId: string;
  flowName: string;
  status: SessionStatus;
  currentNodeId: string | null;
  // The operator's manual-time estimate in minutes; null when never given.
  manualEstimateMinutes: number | null;
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
  // Absent for a caller that does not resolve node types. Only the field report
  // reads it, to tell an approval step's projected decision apart from an
  // author's template field.
  type?: FlowNodeType;
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

// ── Flow deep-dive DTOs ──────────────────────────────────────────────────────

// Each column maps to a unique node+field combination, keyed as `${nodeId}:${fieldKey}`.
export interface FieldReportColumn {
  columnKey: string;
  nodeId: string;
  nodeName: string;
  fieldKey: string;
  label: string;
  type: TemplateFieldType;
  options?: string[];
  // The kind of step the column came from, when the caller supplied it. An
  // `approval` column is a projected decision rather than an authored field, so
  // the UI labels it with its step name and the collapse rules leave it alone.
  nodeType?: FlowNodeType;
  // Same key on fork-sibling (mutually-unreachable live) nodes — collapsible in
  // the "Combine forked steps" view. Absent when the column has no safe sibling.
  collapseGroupId?: string;
  // Same key spanning a node absent from the current flow version (historical
  // records) — collapsible in the "Combine across versions" view.
  versionGroupId?: string;
}

export interface FieldReportSessionRow {
  sessionId: string;
  startedAt: Date;
  status: SessionStatus;
  values: Record<string, string>;
}

export interface FieldReport {
  columns: FieldReportColumn[];
  rows: FieldReportSessionRow[];
}

// ── Extraction-run field report ──────────────────────────────────────────────
// The extraction analogue of the Insights field report (phase §5): per-record
// rows × extraction-field columns, structurally what computeFieldReport produces
// for guided flows but keyed on records rather than sessions. Session metrics
// (completion rate, drop-off) do not apply to a batch, so this is the reuse.

export interface ExtractionReportField {
  key: string;
  label: string;
  type: TemplateFieldType;
}

export interface ExtractionFieldReportColumn {
  fieldKey: string;
  label: string;
  type: TemplateFieldType;
}

export interface ExtractionFieldReportRow {
  recordId: string;
  label: string;
  aggregateConfidence: number;
  values: Record<string, string>;
}

export interface ExtractionFieldReport {
  columns: ExtractionFieldReportColumn[];
  rows: ExtractionFieldReportRow[];
}

export const computeExtractionFieldReport = (
  fields: ExtractionReportField[],
  records: ExtractionRecord[],
): ExtractionFieldReport => {
  const columns: ExtractionFieldReportColumn[] = fields.map((field) => ({
    fieldKey: field.key,
    label: field.label,
    type: field.type,
  }));

  const rows: ExtractionFieldReportRow[] = records.map((record) => {
    const byKey = new Map(record.fields.map((field) => [field.key, field.value]));
    const values: Record<string, string> = {};
    for (const field of fields) values[field.key] = byKey.get(field.key) ?? "";
    return {
      recordId: record.id,
      label: record.label,
      aggregateConfidence: aggregateConfidence(record),
      values,
    };
  });

  return { columns, rows };
};

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

interface NodeForReport {
  id: string;
  name: string;
  type?: FlowNodeType;
}

interface SessionForReport {
  id: string;
  status: SessionStatus;
  createdAt: Date;
}

interface StepOutputForReport {
  sessionId: string;
  nodeId: string;
  createdAt: Date;
  fields: StepOutputField[];
}

// Same key on fork-sibling live nodes collapse under this deterministic id.
const forkGroupId = (fieldKey: string, nodeIds: string[]): string =>
  `${fieldKey}::${[...nodeIds].sort().join("+")}`;

// Tags columns with `collapseGroupId` (fork-siblings within the live graph) and
// `versionGroupId` (a key whose records span a node no longer in the live flow).
// Both are presentational hints — the UI decides whether to honour them. Mutates
// the passed columns in place; only invoked when `edges` is supplied so the
// no-edges call path stays byte-for-byte unchanged.
const annotateCollapseGroups = (
  columns: FieldReportColumn[],
  rows: FieldReportSessionRow[],
  liveNodeIds: Set<string>,
  edges: FlowGraphEdge[],
): void => {
  const byFieldKey = new Map<string, FieldReportColumn[]>();
  for (const column of columns) {
    const list = byFieldKey.get(column.fieldKey) ?? [];
    list.push(column);
    byFieldKey.set(column.fieldKey, list);
  }

  for (const [fieldKey, fieldColumns] of byFieldKey.entries()) {
    // Every approval step projects the same key set (`outcome`, `decided_at`,
    // …), so a shared key across approval steps is an artefact of the
    // projection, not the reused template slot both rules below exist to
    // coalesce. Merging two sign-offs into one column loses which step decided
    // what, which is the whole point of the step-namespaced record (ADR-040 §5).
    //
    // The *group* is skipped, not just its approval columns: a step deleted from
    // the flow has no type to test, and leaving its historical column behind
    // would let the version rule merge it onto a live sign-off.
    if (fieldColumns.some((column) => column.nodeType === "approval")) continue;

    const liveColumns = fieldColumns.filter((column) => liveNodeIds.has(column.nodeId));
    const liveNodeIdsForKey = liveColumns.map((column) => column.nodeId);
    for (const group of computeForkSiblingGroups(liveNodeIdsForKey, edges)) {
      if (group.length < 2) continue;
      const groupId = forkGroupId(fieldKey, group);
      for (const column of liveColumns) {
        if (group.includes(column.nodeId)) column.collapseGroupId = groupId;
      }
    }

    const hasHistorical = fieldColumns.some((column) => !liveNodeIds.has(column.nodeId));
    if (!hasHistorical || fieldColumns.length < 2) continue;

    const memberKeys = new Set(fieldColumns.map((column) => column.columnKey));
    const coOccurs = rows.some(
      (row) => Object.keys(row.values).filter((key) => memberKeys.has(key)).length >= 2,
    );
    if (coOccurs) continue;
    for (const column of fieldColumns) column.versionGroupId = `${fieldKey}::version`;
  }
};

// A key an approval step used to project and no longer does. Its rows are still
// on disk, and the report builds columns from whatever the rows contain, so a
// flow's approval history would keep the column alive long after the write
// stopped. Skipping it on read retires it everywhere at once.
//
// Scoped to approval steps because only they are safe: an approval step has no
// author-defined fields, just projected ones, so nothing here can swallow a
// template field somebody wrote. A step deleted from the flow has no type and
// keeps its column, which is what every historical column for a deleted node
// already does.
const isRetiredApprovalField = (node: NodeForReport | undefined, fieldKey: string): boolean =>
  node?.type === "approval" && fieldKey === "applies_to";

export const computeFieldReport = (
  stepOutputs: StepOutputForReport[],
  nodes: NodeForReport[],
  sessions: SessionForReport[],
  edges?: FlowGraphEdge[],
): FieldReport => {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));

  const columns: FieldReportColumn[] = [];
  const seenColumnKeys = new Set<string>();
  const bySession = new Map<string, StepOutputForReport[]>();

  for (const output of stepOutputs) {
    for (const field of output.fields) {
      // Narrative prose is rendered into the document but never reported on — it
      // is unbounded free text with no comparable value across sessions.
      if (field.type === "narrative") continue;
      const node = nodeMap.get(output.nodeId);
      if (isRetiredApprovalField(node, field.key)) continue;
      const columnKey = `${output.nodeId}:${field.key}`;
      if (!seenColumnKeys.has(columnKey)) {
        seenColumnKeys.add(columnKey);
        columns.push({
          columnKey,
          nodeId: output.nodeId,
          nodeName: node?.name ?? output.nodeId,
          fieldKey: field.key,
          label: field.label,
          type: field.type,
          options: field.options,
          ...(node?.type ? { nodeType: node.type } : {}),
        });
      }
    }
    const list = bySession.get(output.sessionId) ?? [];
    list.push(output);
    bySession.set(output.sessionId, list);
  }

  const rows: FieldReportSessionRow[] = [];
  for (const [sessionId, outputs] of bySession.entries()) {
    const sessionData = sessionMap.get(sessionId);
    const values: Record<string, string> = {};

    const sorted = [...outputs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const output of sorted) {
      for (const field of output.fields) {
        if (field.type === "narrative") continue;
        if (isRetiredApprovalField(nodeMap.get(output.nodeId), field.key)) continue;
        // A group is unbounded structured content; only its item count is a
        // comparable, reportable signal (ADR-032 §4). The rendered items live in
        // the document, never in a report column.
        values[`${output.nodeId}:${field.key}`] =
          field.type === "group" ? String(field.items?.length ?? 0) : field.value;
      }
    }

    rows.push({
      sessionId,
      startedAt: sessionData?.createdAt ?? outputs[0]!.createdAt,
      status: sessionData?.status ?? "active",
      values,
    });
  }

  rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  if (edges !== undefined) {
    annotateCollapseGroups(columns, rows, new Set(nodes.map((node) => node.id)), edges);
  }

  return { columns, rows };
};
