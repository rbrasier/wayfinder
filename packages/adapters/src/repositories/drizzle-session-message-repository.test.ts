import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildAggregateGatheredContextStatement,
  buildLatestBySessionStatement,
  buildListSinceStatement,
  buildListSinceSeqStatement,
  buildSessionListLastAssistantStatement,
  buildSessionListBestConfidenceStatement,
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

describe("buildAggregateGatheredContextStatement", () => {
  it("reads only the contextGathered slice of ai_payload and orders by seq", () => {
    const { sql, params } = render(buildAggregateGatheredContextStatement("session-agg"));
    const text = sql.toLowerCase();

    expect(text).toContain("ai_payload");
    expect(text).toContain("'contextgathered'");
    expect(text).toContain("order by");
    expect(text).toContain("asc");
    expect(text).toContain("role");
    expect(text).toContain("step_node_id");
    expect(params).toContain("session-agg");
  });

  it("filters out messages whose contextGathered is not a JSON array", () => {
    const { sql } = render(buildAggregateGatheredContextStatement("session-agg"));
    const text = sql.toLowerCase();
    expect(text).toContain("jsonb_typeof");
    expect(text).toContain("'array'");
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

describe("buildSessionListLastAssistantStatement", () => {
  it("takes one newest assistant row per session across the whole batch", () => {
    const { sql, params } = render(
      buildSessionListLastAssistantStatement(["session-1", "session-2"]),
    );
    const text = sql.toLowerCase();

    // DISTINCT ON + seq DESC is what keeps this the latest assistant message per
    // session rather than a full-history scan (scaling wall #1).
    expect(text).toContain("distinct on");
    expect(text).toContain("order by");
    expect(text).toContain("desc");
    expect(text).toContain("'assistant'");
    expect(params).toContain("session-1");
    expect(params).toContain("session-2");
  });
});

describe("buildSessionListBestConfidenceStatement", () => {
  it("aggregates the highest confidence per session and step in one grouped query", () => {
    const { sql, params } = render(
      buildSessionListBestConfidenceStatement(["session-1", "session-2"]),
    );
    const text = sql.toLowerCase();

    expect(text).toContain("max(");
    expect(text).toContain("group by");
    expect(text).toContain("'assistant'");
    expect(text).toContain("is not null");
    expect(params).toContain("session-1");
    expect(params).toContain("session-2");
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
