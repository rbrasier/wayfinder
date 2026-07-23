import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildClaimPendingStatement } from "./drizzle-extraction-run-repository";

// The claim runs against a live DB, so here we lock in the generated SQL shape:
// a bounded, oldest-first, single-batch UPDATE that atomically leases pending
// documents with FOR UPDATE SKIP LOCKED — never a double-claim, never an
// unbounded rewrite.
const render = (runId: string, limit: number) =>
  new PgDialect().sqlToQuery(buildClaimPendingStatement(runId, limit));

describe("buildClaimPendingStatement", () => {
  it("claims pending rows for one run with SKIP LOCKED", () => {
    const { sql, params } = render("run-1", 10);
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("app_extraction_documents");
    expect(text).toContain("status = 'extracting'");
    expect(text).toContain("attempts = attempts + 1");
    expect(text).toContain("status = 'pending'");
    expect(text).toContain("for update skip locked");
    expect(params).toContain("run-1");
    expect(params).toContain(10);
  });

  it("bounds and orders the claimed batch", () => {
    const { sql } = render("run-1", 5);
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("asc");
    expect(text).toContain("limit");
    // The bounded id set is chosen in a nested select before the update.
    expect(text.indexOf("select")).toBeGreaterThan(text.indexOf("update"));
    expect(text).toContain("returning");
  });
});
