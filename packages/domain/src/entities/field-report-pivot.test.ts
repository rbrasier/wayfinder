import { describe, it, expect } from "vitest";
import { computePivot, type PivotColumn } from "./field-report-pivot";
import type { FieldReportSessionRow } from "./analytics";

const vendorColumn: PivotColumn = {
  columnKey: "n1:vendor",
  label: "Vendor",
  type: "text",
  memberKeys: ["n1:vendor"],
};

const regionColumn: PivotColumn = {
  columnKey: "n1:region",
  label: "Region",
  type: "text",
  memberKeys: ["n1:region"],
};

const costColumn: PivotColumn = {
  columnKey: "n1:cost",
  label: "Cost",
  type: "currency",
  memberKeys: ["n1:cost"],
};

const columns = [vendorColumn, regionColumn, costColumn];

const row = (values: Record<string, string>): FieldReportSessionRow => ({
  sessionId: Math.random().toString(36).slice(2),
  startedAt: new Date("2026-05-01T00:00:00Z"),
  status: "complete",
  values,
});

describe("computePivot — count measure", () => {
  it("counts sessions per group and returns a grand total", () => {
    const rows = [
      row({ "n1:vendor": "Acme", "n1:cost": "100" }),
      row({ "n1:vendor": "Acme", "n1:cost": "200" }),
      row({ "n1:vendor": "Globex", "n1:cost": "50" }),
    ];

    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "count" },
    });

    expect(pivot.secondaryGroups).toBeNull();
    expect(pivot.primaryGroups).toEqual(["Acme", "Globex"]);
    expect(pivot.rows.map((pivotRow) => [pivotRow.key, pivotRow.total.value])).toEqual([
      ["Acme", 2],
      ["Globex", 1],
    ]);
    expect(pivot.grandTotal.value).toBe(3);
    expect(pivot.hasNumericData).toBe(true);
  });

  it("groups sessions with no value under an empty-string group", () => {
    const rows = [row({ "n1:vendor": "Acme" }), row({ "n1:cost": "10" })];

    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "count" },
    });

    expect(pivot.primaryGroups).toContain("");
    expect(pivot.grandTotal.value).toBe(2);
  });
});

describe("computePivot — sum and avg over a currency column", () => {
  const rows = [
    row({ "n1:vendor": "Acme", "n1:cost": "$1,000" }),
    row({ "n1:vendor": "Acme", "n1:cost": "$3,000" }),
    row({ "n1:vendor": "Globex", "n1:cost": "$500" }),
  ];

  it("sums the numeric column per group", () => {
    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "sum", columnKey: "n1:cost" },
    });

    expect(pivot.rows.map((pivotRow) => [pivotRow.key, pivotRow.total.value])).toEqual([
      ["Acme", 4000],
      ["Globex", 500],
    ]);
    expect(pivot.grandTotal.value).toBe(4500);
  });

  it("averages the numeric column per group without summing cell averages", () => {
    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "avg", columnKey: "n1:cost" },
    });

    const acme = pivot.rows.find((pivotRow) => pivotRow.key === "Acme");
    expect(acme?.total.value).toBe(2000);
    expect(acme?.total.sampleCount).toBe(2);
    expect(pivot.grandTotal.value).toBe(1500);
  });
});

describe("computePivot — degradation with no numeric data", () => {
  it("reports hasNumericData false when a sum measure finds no numbers", () => {
    const rows = [
      row({ "n1:vendor": "Acme", "n1:cost": "pending" }),
      row({ "n1:vendor": "Globex", "n1:cost": "" }),
    ];

    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "sum", columnKey: "n1:cost" },
    });

    expect(pivot.hasNumericData).toBe(false);
    expect(pivot.grandTotal.value).toBe(0);
    expect(pivot.grandTotal.sampleCount).toBe(0);
  });

  it("returns empty groups and no numeric data for an empty row set", () => {
    const pivot = computePivot([], {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "count" },
    });

    expect(pivot.primaryGroups).toEqual([]);
    expect(pivot.rows).toEqual([]);
    expect(pivot.hasNumericData).toBe(false);
  });

  it("ignores non-numeric rows in an average but still counts the numeric ones", () => {
    const rows = [
      row({ "n1:vendor": "Acme", "n1:cost": "100" }),
      row({ "n1:vendor": "Acme", "n1:cost": "n/a" }),
    ];

    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      measure: { kind: "avg", columnKey: "n1:cost" },
    });

    expect(pivot.grandTotal.value).toBe(100);
    expect(pivot.grandTotal.sampleCount).toBe(1);
  });
});

describe("computePivot — secondary group-by matrix", () => {
  const rows = [
    row({ "n1:vendor": "Acme", "n1:region": "EU", "n1:cost": "100" }),
    row({ "n1:vendor": "Acme", "n1:region": "US", "n1:cost": "200" }),
    row({ "n1:vendor": "Globex", "n1:region": "EU", "n1:cost": "300" }),
  ];

  it("builds a primary × secondary matrix with row, column, and grand totals", () => {
    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      secondaryGroupByKey: "n1:region",
      measure: { kind: "sum", columnKey: "n1:cost" },
    });

    expect(pivot.secondaryGroups).toEqual(["EU", "US"]);
    // Acme and Globex both total 300 → tie broken alphabetically.
    expect(pivot.primaryGroups).toEqual(["Acme", "Globex"]);

    const acme = pivot.rows.find((pivotRow) => pivotRow.key === "Acme");
    const euIndex = pivot.secondaryGroups!.indexOf("EU");
    const usIndex = pivot.secondaryGroups!.indexOf("US");
    expect(acme?.cells[euIndex]?.value).toBe(100);
    expect(acme?.cells[usIndex]?.value).toBe(200);
    expect(acme?.total.value).toBe(300);

    expect(pivot.columnTotals[euIndex]?.value).toBe(400);
    expect(pivot.columnTotals[usIndex]?.value).toBe(200);
    expect(pivot.grandTotal.value).toBe(600);
  });

  it("orders groups by descending total so the chart ranks them", () => {
    const pivot = computePivot(rows, {
      columns,
      groupByKey: "n1:vendor",
      secondaryGroupByKey: "n1:region",
      measure: { kind: "count" },
    });

    // Globex(EU)=1, Acme total=2 → Acme ranks first; EU(2) ranks before US(1).
    expect(pivot.primaryGroups[0]).toBe("Acme");
    expect(pivot.secondaryGroups?.[0]).toBe("EU");
  });
});

describe("computePivot — collapsed columns", () => {
  it("coalesces member keys when grouping by a collapsed display column", () => {
    const collapsed: PivotColumn = {
      columnKey: "vendor::group",
      label: "Vendor",
      type: "text",
      memberKeys: ["n1:vendor", "n2:vendor"],
    };
    const rows = [
      row({ "n1:vendor": "Acme" }),
      row({ "n2:vendor": "Acme" }),
      row({ "n2:vendor": "Globex" }),
    ];

    const pivot = computePivot(rows, {
      columns: [collapsed],
      groupByKey: "vendor::group",
      measure: { kind: "count" },
    });

    const acme = pivot.rows.find((pivotRow) => pivotRow.key === "Acme");
    expect(acme?.total.value).toBe(2);
  });
});
