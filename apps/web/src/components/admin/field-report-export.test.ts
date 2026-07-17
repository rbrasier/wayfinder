import { describe, expect, it } from "vitest";
import type { FieldReportSessionRow } from "@rbrasier/domain";
import {
  buildInsightsSheetData,
  insightsExportFileName,
  type ExportColumn,
} from "./field-report-export";

const costColumn: ExportColumn = {
  label: "Cost",
  type: "currency",
  memberKeys: ["n1:cost"],
};

const vendorColumn: ExportColumn = {
  label: "Vendor",
  type: "text",
  memberKeys: ["n1:vendor"],
};

const row = (values: Record<string, string>): FieldReportSessionRow => ({
  sessionId: "s1",
  startedAt: new Date("2026-05-04T10:00:00Z"),
  status: "complete",
  values,
});

describe("buildInsightsSheetData", () => {
  it("writes a bold header row with Started, Status, then each column", () => {
    const data = buildInsightsSheetData([costColumn, vendorColumn], []);

    expect(data[0]).toEqual([
      { value: "Started", fontWeight: "bold", type: String },
      { value: "Status", fontWeight: "bold", type: String },
      { value: "Cost", fontWeight: "bold", type: String },
      { value: "Vendor", fontWeight: "bold", type: String },
    ]);
  });

  it("writes numeric columns as Number cells and text columns as String cells", () => {
    const data = buildInsightsSheetData(
      [costColumn, vendorColumn],
      [row({ "n1:cost": "$1,200", "n1:vendor": "Acme" })],
    );

    const [, , cost, vendor] = data[1]!;
    expect(cost).toEqual({ value: 1200, type: Number });
    expect(vendor).toEqual({ value: "Acme", type: String });
  });

  it("writes a blank cell for an empty value", () => {
    const data = buildInsightsSheetData([costColumn], [row({})]);

    expect(data[1]![2]).toBeNull();
  });

  it("keeps an unparseable numeric value as text", () => {
    const data = buildInsightsSheetData([costColumn], [row({ "n1:cost": "TBD" })]);

    expect(data[1]![2]).toEqual({ value: "TBD", type: String });
  });

  it("formats the Started date and Status label", () => {
    const data = buildInsightsSheetData([], [row({})]);

    expect(data[1]![0]).toEqual({ value: "2026-05-04", type: String });
    expect(data[1]![1]).toEqual({ value: "Complete", type: String });
  });

  it("coalesces member keys for a collapsed column", () => {
    const collapsed: ExportColumn = {
      label: "Cost",
      type: "currency",
      memberKeys: ["n1:cost", "n2:cost"],
    };
    const data = buildInsightsSheetData([collapsed], [row({ "n2:cost": "50" })]);

    expect(data[1]![2]).toEqual({ value: 50, type: Number });
  });
});

describe("insightsExportFileName", () => {
  it("builds a slugged filename with the export date", () => {
    const name = insightsExportFileName("Procurement Request", new Date("2026-07-17T09:00:00Z"));

    expect(name).toBe("Procurement-Request-insights-2026-07-17.xlsx");
  });

  it("collapses unsafe characters", () => {
    const name = insightsExportFileName("HR / On-boarding!", new Date("2026-01-02T00:00:00Z"));

    expect(name).toBe("HR-On-boarding-insights-2026-01-02.xlsx");
  });

  it("falls back to a default stem when the name is empty", () => {
    const name = insightsExportFileName("   ", new Date("2026-01-02T00:00:00Z"));

    expect(name).toBe("flow-insights-2026-01-02.xlsx");
  });
});
