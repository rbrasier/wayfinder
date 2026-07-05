import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildClaimDueStatement } from "./drizzle-schedule-repository";

// The claim's concurrency guarantee (disjoint batches under two claimants) is a
// Postgres behaviour that only a live DB can exercise; here we lock in the shape
// of the generated statement so it can never silently regress to a bare,
// non-claiming SELECT (which is what allowed the double-fire).
describe("buildClaimDueStatement", () => {
  const render = (now: Date, batchSize: number, leaseUntil: Date) =>
    new PgDialect().sqlToQuery(buildClaimDueStatement(now, batchSize, leaseUntil));

  const now = new Date("2026-07-02T00:00:00.000Z");
  const leaseUntil = new Date("2026-07-02T00:15:00.000Z");

  it("claims durably with an UPDATE that skips locked rows and returns them", () => {
    const { sql } = render(now, 50, leaseUntil);
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("for update skip locked");
    expect(text).toContain("returning");
  });

  it("leases the claimed rows forward so a concurrent claim cannot re-select them", () => {
    const { sql, params } = render(now, 10, leaseUntil);
    const text = sql.toLowerCase();

    expect(text).toContain("set next_fire_at");
    // leaseUntil (SET), now (due cutoff), and batchSize (LIMIT) are all bound.
    expect(params).toContain(leaseUntil.toISOString());
    expect(params).toContain(now.toISOString());
    expect(params.length).toBeGreaterThanOrEqual(3);
  });

  it("binds the timestamps as serializable ISO strings cast to timestamptz", () => {
    // Regression: postgres.js cannot serialize a bare Date passed through a raw
    // sql template (no column serializer applies), so the tick threw
    // "The 'string' argument must be of type string ... Received an instance of
    // Date". The params must be strings and the SQL must cast them to timestamptz
    // so the timestamptz comparison stays correct.
    const { sql, params } = render(now, 10, leaseUntil);

    expect(sql.toLowerCase()).toContain("::timestamptz");
    for (const value of [now, leaseUntil]) {
      expect(params).not.toContain(value);
      expect(params).toContain(value.toISOString());
    }
    for (const param of params) {
      expect(param).not.toBeInstanceOf(Date);
    }
  });

  it("orders by soonest due and bounds the batch", () => {
    const { sql, params } = render(now, 25, leaseUntil);
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("limit");
    expect(params).toContain(25);
  });
});
