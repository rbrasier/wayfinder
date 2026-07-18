import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { RetentionTargetKey } from "@rbrasier/domain";
import {
  RETENTION_TARGET_TABLE_NAMES,
  buildAuditRetentionDeleteStatement,
  buildDeleteExpiredStatement,
} from "./drizzle-retention-repository";

// The sweep runs against a live DB, so here we lock in the generated SQL shape:
// a bounded, ordered, single-batch delete that can never silently regress into
// an unbounded table rewrite (scaling wall #9).
const render = (key: RetentionTargetKey, cutoff: Date, batchSize: number) =>
  new PgDialect().sqlToQuery(buildDeleteExpiredStatement(key, cutoff, batchSize));

const cutoff = new Date("2026-04-05T00:00:00.000Z");

describe("buildDeleteExpiredStatement", () => {
  it("deletes only rows older than the cutoff, bounded by a batch limit", () => {
    const { sql, params } = render("app_error_log", cutoff, 500);
    const text = sql.toLowerCase();

    expect(text).toContain("delete from");
    expect(text).toContain("app_error_log");
    expect(text).toContain("created_at");
    expect(text).toContain("<");
    expect(text).toContain("limit");
    expect(params).toContain(cutoff);
    expect(params).toContain(500);
  });

  it("selects the batch by oldest-first ordering inside a subquery", () => {
    const { sql } = render("app_error_log", cutoff, 500);
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("asc");
    // The bounded set of ids to delete is chosen in a nested select.
    expect(text.indexOf("select")).toBeGreaterThan(text.indexOf("delete from"));
    expect(text).toContain("returning");
  });

  it("targets the correct table for every retention key", () => {
    for (const [key, tableName] of Object.entries(RETENTION_TARGET_TABLE_NAMES)) {
      const { sql } = render(key as RetentionTargetKey, cutoff, 100);
      expect(sql.toLowerCase()).toContain(tableName);
    }
  });

  it("excludes held sessions from a session-scoped target (ADR-033)", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      buildDeleteExpiredStatement("app_session_messages", cutoff, 100, ["s-1", "s-2"]),
    );
    const text = sql.toLowerCase();
    expect(text).toContain("not (");
    expect(text).toContain("= any(array[");
    expect(params).toContain("s-1");
    expect(params).toContain("s-2");
  });

  it("adds no session exclusion when nothing is held", () => {
    const { sql } = new PgDialect().sqlToQuery(
      buildDeleteExpiredStatement("app_session_messages", cutoff, 100, []),
    );
    expect(sql.toLowerCase()).not.toContain("any(");
  });
});

describe("buildAuditRetentionDeleteStatement", () => {
  it("routes audit deletion through the append-only-safe function, not a raw DELETE", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      buildAuditRetentionDeleteStatement(cutoff, 500, ["s-1"]),
    );
    const text = sql.toLowerCase();
    expect(text).toContain("core_audit_log_retention_delete");
    expect(text).not.toContain("delete from");
    expect(params).toContain(cutoff);
    expect(params).toContain(500);
    expect(params).toContain("s-1");
  });
});
