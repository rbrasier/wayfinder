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
    expect(params).toContain(leaseUntil);
    expect(params).toContain(now);
    expect(params.length).toBeGreaterThanOrEqual(3);
  });

  it("orders by soonest due and bounds the batch", () => {
    const { sql, params } = render(now, 25, leaseUntil);
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("limit");
    expect(params).toContain(25);
  });
});
