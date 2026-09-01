import { describe, it, expect } from "vitest";
import {
  computeExtractionFieldReport,
  computeFieldReport,
  computeFlowDistribution,
  computeOverviewMetrics,
  computeSessionActivity,
  type AnalyticsMessageRow,
  type AnalyticsNode,
  type AnalyticsSessionRow,
} from "./analytics";
import { APPROVAL_PROJECTION_FIELDS } from "./approval-record";
import type { ExtractionRecord } from "./extraction-record";

const session = (overrides: Partial<AnalyticsSessionRow>): AnalyticsSessionRow => ({
  id: "s1",
  flowId: "f1",
  flowName: "Flow One",
  status: "active",
  currentNodeId: null,
  manualEstimateMinutes: null,
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

  it("reports a group field as its item count, never per-item columns", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [
            {
              key: "suppliers",
              label: "Suppliers",
              type: "group",
              value: "",
              items: [
                { name: "Acme", pricing: "£100" },
                { name: "Globex", pricing: "£200" },
              ],
            },
          ],
        },
      ],
      [nodeIntake],
      [sessionS1],
    );

    const suppliersColumn = report.columns.find((column) => column.columnKey === "n1:suppliers");
    expect(suppliersColumn?.type).toBe("group");
    expect(report.columns).toHaveLength(1);
    expect(report.rows[0]?.values["n1:suppliers"]).toBe("2");
  });

  it("reports an empty group as a count of zero", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [{ key: "suppliers", label: "Suppliers", type: "group", value: "" }],
        },
      ],
      [nodeIntake],
      [sessionS1],
    );
    expect(report.rows[0]?.values["n1:suppliers"]).toBe("0");
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

  it("assigns no group ids when called without edges (byte-for-byte as today)", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
      ],
      [nodeIntake, nodeApproval],
      [sessionS1, sessionS2],
    );

    expect(report.columns.every((column) => column.collapseGroupId === undefined)).toBe(true);
    expect(report.columns.every((column) => column.versionGroupId === undefined)).toBe(true);
  });

  it("gives fork-sibling columns sharing a field key the same collapseGroupId", () => {
    // n1 and n2 are the two branches of a fork that rejoins at n3 — mutually
    // unreachable, so the shared `amount` field collapses into one group.
    const edges = [
      { fromNodeId: "n0", toNodeId: "n1" },
      { fromNodeId: "n0", toNodeId: "n2" },
      { fromNodeId: "n1", toNodeId: "n3" },
      { fromNodeId: "n2", toNodeId: "n3" },
    ];
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
      ],
      [
        { id: "n1", name: "Standard" },
        { id: "n2", name: "Approval" },
      ],
      [sessionS1, sessionS2],
      edges,
    );

    const columnOne = report.columns.find((column) => column.columnKey === "n1:amount");
    const columnTwo = report.columns.find((column) => column.columnKey === "n2:amount");
    expect(columnOne?.collapseGroupId).toBeDefined();
    expect(columnOne?.collapseGroupId).toBe(columnTwo?.collapseGroupId);
    expect(columnOne?.collapseGroupId).toBe("amount::n1+n2");
  });

  it("never collapses a step reachable from both branches even when the key matches", () => {
    // n3 is downstream of both branches: a session can reach a branch AND n3, so
    // its `amount` must stay a distinct column.
    const edges = [
      { fromNodeId: "n0", toNodeId: "n1" },
      { fromNodeId: "n0", toNodeId: "n2" },
      { fromNodeId: "n1", toNodeId: "n3" },
      { fromNodeId: "n2", toNodeId: "n3" },
    ];
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s1",
          nodeId: "n3",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$30.00" }],
        },
      ],
      [
        { id: "n1", name: "Standard" },
        { id: "n3", name: "Finance Sign-off" },
      ],
      [sessionS1],
      edges,
    );

    const branchColumn = report.columns.find((column) => column.columnKey === "n1:amount");
    const downstreamColumn = report.columns.find((column) => column.columnKey === "n3:amount");
    expect(branchColumn?.collapseGroupId).toBeUndefined();
    expect(downstreamColumn?.collapseGroupId).toBeUndefined();
  });

  it("gives different field keys on fork-siblings distinct group ids", () => {
    const edges = [
      { fromNodeId: "n0", toNodeId: "n1" },
      { fromNodeId: "n0", toNodeId: "n2" },
    ];
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "fee", label: "Fee", type: "currency", value: "$20.00" }],
        },
      ],
      [
        { id: "n1", name: "Standard" },
        { id: "n2", name: "Approval" },
      ],
      [sessionS1, sessionS2],
      edges,
    );

    expect(report.columns.every((column) => column.collapseGroupId === undefined)).toBe(true);
  });

  it("collapses a historical (other-version) column into the live one via versionGroupId", () => {
    // n_old is not in the live node list (deleted in a later version); its
    // `amount` records can never co-occur with the live n1 in a single session,
    // so they share a versionGroupId.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n_old",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
      ],
      [{ id: "n1", name: "Intake" }],
      [sessionS1, sessionS2],
      [],
    );

    const liveColumn = report.columns.find((column) => column.columnKey === "n1:amount");
    const historicalColumn = report.columns.find((column) => column.columnKey === "n_old:amount");
    expect(liveColumn?.versionGroupId).toBeDefined();
    expect(liveColumn?.versionGroupId).toBe(historicalColumn?.versionGroupId);
    expect(liveColumn?.versionGroupId).toBe("amount::version");
  });

  it("does not assign a versionGroupId when every column is a live node", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
      ],
      [{ id: "n1", name: "Intake" }],
      [sessionS1],
      [],
    );

    expect(report.columns[0]?.versionGroupId).toBeUndefined();
  });

  it("skips cross-version collapse when two columns of the key co-occur in one session", () => {
    // A single session populated both the live and historical column for the
    // same key, proving they are not mutually exclusive — leave them split.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s1",
          nodeId: "n_old",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
      ],
      [{ id: "n1", name: "Intake" }],
      [sessionS1],
      [],
    );

    expect(report.columns.every((column) => column.versionGroupId === undefined)).toBe(true);
  });

  it("tags each column with the type of the step that produced it", () => {
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
        },
      ],
      [
        { id: "n1", name: "Intake", type: "conversational" },
        { id: "n2", name: "Finance Sign-off", type: "approval" },
      ],
      [sessionS1],
      [],
    );

    expect(report.columns.find((column) => column.columnKey === "n1:amount")?.nodeType).toBe(
      "conversational",
    );
    expect(report.columns.find((column) => column.columnKey === "n2:outcome")?.nodeType).toBe(
      "approval",
    );
  });

  it("never fork-collapses two approval steps that share a projected key", () => {
    // Every approval step projects the same `outcome` key by construction, so
    // the shared key says nothing about the author's intent — unlike a template
    // field, where a shared key means one reused slot. Two sign-offs on the two
    // branches of a fork must stay two columns.
    const edges = [
      { fromNodeId: "n0", toNodeId: "n1" },
      { fromNodeId: "n0", toNodeId: "n2" },
      { fromNodeId: "n1", toNodeId: "n3" },
      { fromNodeId: "n2", toNodeId: "n3" },
    ];
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
        },
        {
          sessionId: "s2",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "rejected" }],
        },
      ],
      [
        { id: "n1", name: "Finance Sign-off", type: "approval" },
        { id: "n2", name: "Legal Sign-off", type: "approval" },
      ],
      [sessionS1, sessionS2],
      edges,
    );

    expect(report.columns).toHaveLength(2);
    expect(report.columns.every((column) => column.collapseGroupId === undefined)).toBe(true);
  });

  it("never version-collapses an approval step onto a historical one", () => {
    // The live approval step and a deleted one never co-occur in a session, so
    // the version rule would merge a finance sign-off into a legal one. The
    // whole key group is skipped once any column in it is an approval column,
    // because the historical node is absent from the flow and so has no type.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
        },
        {
          sessionId: "s2",
          nodeId: "n_old",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "rejected" }],
        },
      ],
      [{ id: "n1", name: "Finance Sign-off", type: "approval" }],
      [sessionS1, sessionS2],
      [],
    );

    expect(report.columns).toHaveLength(2);
    expect(report.columns.every((column) => column.versionGroupId === undefined)).toBe(true);
  });

  it("still collapses template fields when an approval step is present in the flow", () => {
    // The approval exclusion is scoped to the key group it appears in: an
    // ordinary fork-sibling template field must collapse exactly as before.
    const edges = [
      { fromNodeId: "n0", toNodeId: "n1" },
      { fromNodeId: "n0", toNodeId: "n2" },
      { fromNodeId: "n1", toNodeId: "n3" },
      { fromNodeId: "n2", toNodeId: "n3" },
    ];
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n2",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
        {
          sessionId: "s1",
          nodeId: "n4",
          createdAt: new Date(),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
        },
      ],
      [
        { id: "n1", name: "Standard", type: "conversational" },
        { id: "n2", name: "Expedited", type: "conversational" },
        { id: "n4", name: "Finance Sign-off", type: "approval" },
      ],
      [sessionS1, sessionS2],
      edges,
    );

    expect(report.columns.find((column) => column.columnKey === "n1:amount")?.collapseGroupId).toBe(
      "amount::n1+n2",
    );
  });

  it("shows the most recent decision when a step was decided more than once", () => {
    // A change request routes work back; re-entering the step raises a fresh
    // request and projects a second row. The report must read as the step
    // currently stands — a superseded "changes_requested" would say the work
    // was sent back when it has since been approved.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T09:00:00Z"),
          fields: [
            { key: "outcome", label: "Outcome", type: "text", value: "changes_requested" },
            { key: "revision", label: "Revision", type: "number", value: "1" },
          ],
        },
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T11:00:00Z"),
          fields: [
            { key: "outcome", label: "Outcome", type: "text", value: "approved" },
            { key: "revision", label: "Revision", type: "number", value: "2" },
          ],
        },
      ],
      [{ id: "n2", name: "Finance Sign-off", type: "approval" }],
      [sessionS1],
      [],
    );

    expect(report.rows[0]?.values["n2:outcome"]).toBe("approved");
    expect(report.rows[0]?.values["n2:revision"]).toBe("2");
  });

  it("orders repeat decisions by when they happened, not by row order", () => {
    // The repository makes no ordering promise, so the newest decision must win
    // even when it arrives first in the list.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T11:00:00Z"),
          fields: [{ key: "outcome", label: "Outcome", type: "text", value: "approved" }],
        },
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T09:00:00Z"),
          fields: [
            { key: "outcome", label: "Outcome", type: "text", value: "changes_requested" },
          ],
        },
      ],
      [{ id: "n2", name: "Finance Sign-off", type: "approval" }],
      [sessionS1],
      [],
    );

    expect(report.rows[0]?.values["n2:outcome"]).toBe("approved");
  });

  it("leaves collapse behaviour unchanged when no node carries a type", () => {
    // The extraction report and any caller predating node typing pass untyped
    // nodes; they must keep collapsing exactly as they do today.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$10.00" }],
        },
        {
          sessionId: "s2",
          nodeId: "n_old",
          createdAt: new Date(),
          fields: [{ key: "amount", label: "Amount", type: "currency", value: "$20.00" }],
        },
      ],
      [{ id: "n1", name: "Intake" }],
      [sessionS1, sessionS2],
      [],
    );

    expect(report.columns.every((column) => column.versionGroupId === "amount::version")).toBe(true);
  });

  it("drops the applies_to column an approval step projected before it was retired", () => {
    // The key is gone from APPROVAL_PROJECTION_FIELDS, so nothing writes it any
    // more — but every approval decided before that still carries it, and the
    // report builds its columns from whatever the stored rows contain.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n2",
          createdAt: new Date("2026-05-20T02:00:00Z"),
          fields: [
            { key: "outcome", label: "Outcome", type: "text", value: "approved" },
            { key: "decided_by", label: "Decided by", type: "text", value: "Jane Doe" },
            {
              key: "applies_to",
              label: "Applies to",
              type: "text",
              value: 'the output of the step "Intake"',
            },
          ],
        },
      ],
      [{ id: "n2", name: "Approval", type: "approval" }],
      [sessionS1],
    );

    expect(report.columns.map((column) => column.fieldKey)).toEqual(["outcome", "decided_by"]);
    expect(report.rows[0]?.values["n2:applies_to"]).toBeUndefined();
  });

  it("keeps an applies_to field a non-approval step authored", () => {
    // An approval step has no author-defined fields, only projected ones, which
    // is what makes dropping the key safe there. Anywhere else the same key is
    // somebody's template field and must survive.
    const report = computeFieldReport(
      [
        {
          sessionId: "s1",
          nodeId: "n1",
          createdAt: new Date("2026-05-20T01:00:00Z"),
          fields: [
            { key: "applies_to", label: "Applies to", type: "text", value: "Northern region" },
          ],
        },
      ],
      [{ id: "n1", name: "Intake", type: "conversational" }],
      [sessionS1],
    );

    expect(report.columns.map((column) => column.columnKey)).toEqual(["n1:applies_to"]);
    expect(report.rows[0]?.values["n1:applies_to"]).toBe("Northern region");
  });
});

describe("APPROVAL_PROJECTION_FIELDS", () => {
  it("names the six keys a decision projects, in report order", () => {
    expect(APPROVAL_PROJECTION_FIELDS.map((field) => field.key)).toEqual([
      "outcome",
      "revision",
      "decided_at",
      "decided_by",
      "approver_email",
      "comment",
    ]);
  });

  it("no longer projects the approval subject, which the record still holds", () => {
    expect(APPROVAL_PROJECTION_FIELDS.some((field) => field.key === "applies_to")).toBe(false);
  });

  it("types the revision as a number, so it filters and pivots as one", () => {
    expect(APPROVAL_PROJECTION_FIELDS.find((field) => field.key === "revision")?.type).toBe(
      "number",
    );
    expect(APPROVAL_PROJECTION_FIELDS.find((field) => field.key === "outcome")?.type).toBe("text");
  });

  it("keeps the four pre-existing keys labelled as they were, so old rows keep their column", () => {
    const labels = new Map(APPROVAL_PROJECTION_FIELDS.map((field) => [field.key, field.label]));
    expect(labels.get("outcome")).toBe("Outcome");
    expect(labels.get("decided_at")).toBe("Decided at");
    expect(labels.get("decided_by")).toBe("Decided by");
    expect(labels.get("comment")).toBe("Comment");
  });
});

describe("computeExtractionFieldReport", () => {
  const record = (
    id: string,
    fields: ExtractionRecord["fields"],
    sourceDocumentIds: string[] = [],
  ): ExtractionRecord => ({ id, label: id, fields, sourceDocumentIds });

  it("emits one column per schema field in order and one row per record", () => {
    const report = computeExtractionFieldReport(
      [
        { key: "supplier_name", label: "Supplier", type: "text" },
        { key: "price", label: "Price", type: "currency" },
      ],
      [
        record("r1", [
          { key: "supplier_name", value: "Acme", confidence: 0.9, rationale: "" },
          { key: "price", value: "£10", confidence: 0.4, rationale: "" },
        ]),
        record("r2", [{ key: "supplier_name", value: "Globex", confidence: 0.8, rationale: "" }]),
      ],
    );

    expect(report.columns.map((column) => column.fieldKey)).toEqual(["supplier_name", "price"]);
    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      recordId: "r1",
      values: { supplier_name: "Acme", price: "£10" },
    });
    // Missing field → blank, never undefined.
    expect(report.rows[1]!.values.price).toBe("");
  });

  it("carries each record's aggregate confidence per scale for RAG banding", () => {
    const report = computeExtractionFieldReport(
      [{ key: "price", label: "Price", type: "currency" }],
      [record("r1", [{ key: "price", value: "£10", confidence: 0.3, rationale: "" }])],
    );
    expect(report.rows[0]!.aggregateConfidence).toEqual({ selection: null, accuracy: 0.3 });
  });

  it("keeps a verbatim record's selection confidence off the accuracy scale", () => {
    const report = computeExtractionFieldReport(
      [{ key: "rate", label: "Rate", type: "text" }],
      [
        record("r1", [
          { key: "rate", value: "4.25", confidence: 0.6, rationale: "", provenance: "verbatim" },
        ]),
      ],
    );
    expect(report.rows[0]!.aggregateConfidence).toEqual({ selection: 0.6, accuracy: null });
  });
});
