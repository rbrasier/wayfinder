import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildResumableRunsStatement } from "./drizzle-unattended-run-repository";

// Which runs the sweeper may resume is decided in SQL, so a run parked on a
// person can never be picked up and re-prepared; this pins the filter's shape.
describe("buildResumableRunsStatement", () => {
  const staleBefore = new Date("2026-10-22T00:00:00.000Z");
  const render = () => new PgDialect().sqlToQuery(buildResumableRunsStatement(staleBefore, 20));

  it("only considers active, unattended runs with no error, open turn, pending callback or parked step", () => {
    const text = render().sql.toLowerCase();

    expect(text).toContain(`"origin" <> 'manual'`);
    expect(text).toContain(`"status" = 'active'`);
    expect(text).toContain(`"run_error" is null`);
    expect(text).toContain(`"active_turn_id" is null`);
    expect(text).toContain(`"pending_executions" = '{}'::jsonb`);
    expect(text).toContain(`"awaiting_confirmation_node_id" is null`);
  });

  it("joins the current step and only resumes the step types the driver runs alone", () => {
    const text = render().sql.toLowerCase();

    expect(text).toContain("join");
    expect(text).toContain("'ai_task', 'email', 'auto', 'mcp'");
  });

  it("binds the cutoff as an ISO timestamp and bounds the batch, oldest first", () => {
    const { sql, params } = render();

    expect(params).toContain(staleBefore.toISOString());
    expect(params).toContain(20);
    expect(sql.toLowerCase()).toContain("order by");
  });
});
