import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestBySessionStatement,
  buildListSinceStatement,
  buildListSinceSeqStatement,
} from "./drizzle-session-message-repository";

// The pagination queries are what keep a long session's per-turn read bounded
// (scaling wall #1). A live DB is needed to prove the ordering behaviour, so
// here we lock in the generated SQL shape so it can never silently regress to an
// unbounded full-history scan.
const render = (now: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(now);

describe("buildLatestBySessionStatement", () => {
  it("bounds the read with a LIMIT and filters by session", () => {
    const { sql, params } = render(buildLatestBySessionStatement("session-1", 20));
    const text = sql.toLowerCase();

    expect(text).toContain("where");
    expect(text).toContain("limit");
    expect(params).toContain("session-1");
    expect(params).toContain(20);
  });

  it("takes the newest rows by ordering on created_at descending", () => {
    const { sql } = render(buildLatestBySessionStatement("session-1", 5));
    const text = sql.toLowerCase();

    expect(text).toContain("order by");
    expect(text).toContain("desc");
  });
});

describe("buildListSinceStatement", () => {
  it("returns only rows created after the cursor, in chronological order", () => {
    const after = new Date("2026-07-03T00:00:00.000Z");
    const { sql, params } = render(buildListSinceStatement("session-2", after));
    const text = sql.toLowerCase();

    expect(text).toContain("where");
    expect(text).toContain("order by");
    expect(text).toContain("asc");
    expect(params).toContain("session-2");
    expect(params).toContain(after);
  });
});

describe("buildListSinceSeqStatement", () => {
  it("returns only rows after the seq cursor, ordered by seq ascending", () => {
    const { sql, params } = render(buildListSinceSeqStatement("session-3", 42));
    const text = sql.toLowerCase();

    expect(text).toContain("where");
    expect(text).toContain("seq");
    expect(text).toContain("order by");
    expect(text).toContain("asc");
    expect(params).toContain("session-3");
    expect(params).toContain(42);
  });
});
