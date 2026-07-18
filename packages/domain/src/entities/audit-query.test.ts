import { describe, expect, it } from "vitest";
import {
  AUDIT_QUERY_DEFAULT_LIMIT,
  AUDIT_QUERY_MAX_LIMIT,
  buildAuditQuery,
} from "./audit-query";

describe("buildAuditQuery", () => {
  it("applies default pagination when unspecified", () => {
    const result = buildAuditQuery({});
    expect(result.data?.limit).toBe(AUDIT_QUERY_DEFAULT_LIMIT);
    expect(result.data?.offset).toBe(0);
  });

  it("clamps limit to the maximum", () => {
    const result = buildAuditQuery({ limit: 10_000 });
    expect(result.data?.limit).toBe(AUDIT_QUERY_MAX_LIMIT);
  });

  it("raises a limit below one to the minimum", () => {
    const result = buildAuditQuery({ limit: 0 });
    expect(result.data?.limit).toBe(1);
  });

  it("floors a negative offset at zero", () => {
    const result = buildAuditQuery({ offset: -5 });
    expect(result.data?.offset).toBe(0);
  });

  it("trims blank filter strings to undefined", () => {
    const result = buildAuditQuery({ actorId: "  ", action: "role.changed" });
    expect(result.data?.filter.actorId).toBeUndefined();
    expect(result.data?.filter.action).toBe("role.changed");
  });

  it("keeps a valid date range", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-30T00:00:00.000Z");
    const result = buildAuditQuery({ from, to });
    expect(result.data?.filter.from).toBe(from);
    expect(result.data?.filter.to).toBe(to);
  });

  it("rejects a range whose start is after its end", () => {
    const result = buildAuditQuery({
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});
