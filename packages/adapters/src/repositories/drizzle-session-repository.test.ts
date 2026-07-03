import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildClaimTurnStatement,
  buildHeartbeatTurnStatement,
  buildReleaseTurnStatement,
} from "./drizzle-session-repository";

// The turn lease is the correctness core of scaling wall #3: exactly one turn
// runs at a time and a crashed turn self-heals after the lease window. A live DB
// is needed to prove the atomic behaviour, so here we lock in the generated SQL
// shape so the guard can never silently regress into an unconditional overwrite.
const render = (statement: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  new PgDialect().sqlToQuery(statement);

describe("buildClaimTurnStatement", () => {
  it("claims only when the turn is free or the lease has expired", () => {
    const { sql, params } = render(
      buildClaimTurnStatement("session-1", "turn-1", "user-1", 120),
    );
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("where");
    // Free OR expired — both disjuncts must be present or a stampede slips through.
    expect(text).toContain("active_turn_id");
    expect(text).toContain("is null");
    expect(text).toContain("active_turn_claimed_at");
    // The lease window is parameterised (seconds), never hardcoded in SQL text.
    expect(params).toContain("session-1");
    expect(params).toContain("turn-1");
    expect(params).toContain("user-1");
    expect(params).toContain(120);
  });

  it("returns the row so the caller can tell a win from a loss", () => {
    const { sql } = render(buildClaimTurnStatement("session-1", "turn-1", "user-1", 90));
    expect(sql.toLowerCase()).toContain("returning");
  });
});

describe("buildHeartbeatTurnStatement", () => {
  it("re-stamps only the current holder's lease", () => {
    const { sql, params } = render(buildHeartbeatTurnStatement("session-1", "turn-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("active_turn_claimed_at");
    // Guarded on the turn id so a stale holder cannot extend a newer claim.
    expect(text).toContain("active_turn_id");
    expect(params).toContain("session-1");
    expect(params).toContain("turn-1");
  });
});

describe("buildReleaseTurnStatement", () => {
  it("clears the lease only when the turn id still matches", () => {
    const { sql, params } = render(buildReleaseTurnStatement("session-1", "turn-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("set");
    expect(text).toContain("null");
    expect(text).toContain("active_turn_id");
    expect(params).toContain("session-1");
    expect(params).toContain("turn-1");
  });
});
