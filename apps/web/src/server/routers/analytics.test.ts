import { describe, expect, it } from "vitest";
import {
  buildInsightsExportAuditPayload,
  logInsightsExportInputSchema,
} from "./analytics";

const validInput = {
  flowId: "11111111-1111-1111-1111-111111111111",
  rowCount: 12,
  columnCount: 5,
  filters: {
    datePreset: "last_30",
    statusFilter: "complete",
    filterColumnKey: "n1:cost",
    filterThreshold: "100",
    filterOperator: "gte",
    combineForks: true,
    combineVersions: false,
  },
};

describe("logInsightsExportInputSchema", () => {
  it("accepts a fully specified export event", () => {
    expect(logInsightsExportInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("accepts an event with no filters applied", () => {
    const parsed = logInsightsExportInputSchema.safeParse({
      flowId: validInput.flowId,
      rowCount: 0,
      columnCount: 0,
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a non-uuid flow id", () => {
    expect(
      logInsightsExportInputSchema.safeParse({ ...validInput, flowId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects a negative row count", () => {
    expect(
      logInsightsExportInputSchema.safeParse({ ...validInput, rowCount: -1 }).success,
    ).toBe(false);
  });
});

describe("buildInsightsExportAuditPayload", () => {
  it("maps the actor and input onto the insights.exported audit event", () => {
    const payload = buildInsightsExportAuditPayload("user-123", validInput);

    expect(payload).toEqual({
      actorId: "user-123",
      action: "insights.exported",
      resourceType: "flow",
      resourceId: validInput.flowId,
      metadata: {
        rowCount: 12,
        columnCount: 5,
        filters: validInput.filters,
      },
    });
  });

  it("records an empty filter object when none were applied", () => {
    const payload = buildInsightsExportAuditPayload(null, {
      flowId: validInput.flowId,
      rowCount: 3,
      columnCount: 2,
    });

    expect(payload.actorId).toBeNull();
    expect(payload.metadata).toEqual({ rowCount: 3, columnCount: 2, filters: {} });
  });
});
