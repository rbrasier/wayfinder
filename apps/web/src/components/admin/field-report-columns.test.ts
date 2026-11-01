import { describe, expect, it } from "vitest";
import type { FieldReportColumn } from "@wayfinder/domain";
import {
  approvalRevisionNote,
  buildDisplayColumns,
  qualifiedColumnLabel,
  type DisplayColumn,
} from "./field-report-columns";

const column = (overrides: Partial<FieldReportColumn>): FieldReportColumn => ({
  columnKey: "n1:amount",
  nodeId: "n1",
  nodeName: "Intake",
  fieldKey: "amount",
  label: "Amount",
  type: "currency",
  ...overrides,
});

const display = (overrides: Partial<DisplayColumn>): DisplayColumn => ({
  columnKey: "n1:amount",
  nodeId: "n1",
  nodeName: "Intake",
  fieldKey: "amount",
  label: "Amount",
  type: "currency",
  memberKeys: ["n1:amount"],
  stepNames: ["Intake"],
  ...overrides,
});

describe("buildDisplayColumns", () => {
  it("carries the step type through to the display column", () => {
    const columns = buildDisplayColumns(
      [
        column({}),
        column({
          columnKey: "n2:outcome",
          nodeId: "n2",
          nodeName: "Finance Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
      ],
      true,
      true,
    );

    expect(columns.find((candidate) => candidate.columnKey === "n1:amount")?.nodeType).toBeUndefined();
    expect(columns.find((candidate) => candidate.columnKey === "n2:outcome")?.nodeType).toBe(
      "approval",
    );
  });

  it("keeps two approval steps as two columns", () => {
    // The domain withholds the collapse group ids for approval columns, so
    // nothing here can merge them however the toggles are set.
    const columns = buildDisplayColumns(
      [
        column({
          columnKey: "n1:outcome",
          nodeId: "n1",
          nodeName: "Finance Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
        column({
          columnKey: "n2:outcome",
          nodeId: "n2",
          nodeName: "Legal Sign-off",
          fieldKey: "outcome",
          label: "Outcome",
          type: "text",
          nodeType: "approval",
        }),
      ],
      true,
      true,
    );

    expect(columns).toHaveLength(2);
  });
});

describe("qualifiedColumnLabel", () => {
  it("names the approval step, so two sign-offs never read alike", () => {
    const finance = display({
      columnKey: "n1:outcome",
      nodeName: "Finance Sign-off",
      label: "Outcome",
      nodeType: "approval",
      stepNames: ["Finance Sign-off"],
    });
    const legal = display({
      columnKey: "n2:outcome",
      nodeName: "Legal Sign-off",
      label: "Outcome",
      nodeType: "approval",
      stepNames: ["Legal Sign-off"],
    });

    expect(qualifiedColumnLabel(finance)).toBe("Finance Sign-off — Outcome");
    expect(qualifiedColumnLabel(legal)).toBe("Legal Sign-off — Outcome");
    expect(qualifiedColumnLabel(finance)).not.toBe(qualifiedColumnLabel(legal));
  });

  it("leaves an ordinary template field alone", () => {
    expect(qualifiedColumnLabel(display({}))).toBe("Amount");
  });
});

describe("approvalRevisionNote", () => {
  const outcomeColumn = display({
    columnKey: "n1:outcome",
    nodeId: "n1",
    nodeName: "Finance Sign-off",
    fieldKey: "outcome",
    label: "Outcome",
    type: "text",
    nodeType: "approval",
    memberKeys: ["n1:outcome"],
    stepNames: ["Finance Sign-off"],
  });

  it("notes the pass count when a step was decided more than once", () => {
    expect(approvalRevisionNote(outcomeColumn, { "n1:outcome": "approved", "n1:revision": "2" }))
      .toBe("Revision 2");
  });

  it("notes any pass count, not just a second one", () => {
    for (const revision of ["3", "7", "12"]) {
      expect(approvalRevisionNote(outcomeColumn, { "n1:revision": revision })).toBe(
        `Revision ${revision}`,
      );
    }
  });

  it("stays silent on a first-pass decision, so the common case reads clean", () => {
    expect(
      approvalRevisionNote(outcomeColumn, { "n1:outcome": "approved", "n1:revision": "1" }),
    ).toBeNull();
  });

  it("stays silent for a row projected before revisions were counted", () => {
    expect(approvalRevisionNote(outcomeColumn, { "n1:outcome": "approved" })).toBeNull();
  });

  it("annotates only the outcome, not every column of the step", () => {
    const comment = display({
      columnKey: "n1:comment",
      nodeId: "n1",
      fieldKey: "comment",
      label: "Comment",
      type: "text",
      nodeType: "approval",
      memberKeys: ["n1:comment"],
    });

    expect(approvalRevisionNote(comment, { "n1:revision": "2" })).toBeNull();
  });

  it("ignores a template field that happens to be called outcome", () => {
    const templateField = display({
      columnKey: "n1:outcome",
      nodeId: "n1",
      fieldKey: "outcome",
      label: "Outcome",
      type: "text",
      memberKeys: ["n1:outcome"],
    });

    expect(approvalRevisionNote(templateField, { "n1:revision": "2" })).toBeNull();
  });

  it("names the approval step for its revision column too", () => {
    const revision = display({
      columnKey: "n1:revision",
      nodeName: "Finance Sign-off",
      fieldKey: "revision",
      label: "Revision",
      type: "number",
      nodeType: "approval",
      stepNames: ["Finance Sign-off"],
    });

    expect(qualifiedColumnLabel(revision)).toBe("Finance Sign-off — Revision");
  });

  it("lists the merged steps for a collapsed column", () => {
    const collapsed = display({
      columnKey: "amount",
      memberKeys: ["n1:amount", "n2:amount"],
      stepNames: ["Standard", "Expedited"],
    });

    expect(qualifiedColumnLabel(collapsed)).toBe("Standard · Expedited — Amount");
  });
});
