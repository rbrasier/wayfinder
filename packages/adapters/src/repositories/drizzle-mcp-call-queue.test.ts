import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildClaimMcpCallsStatement, toMcpCallJob } from "./drizzle-mcp-call-queue";

// The claim runs against a live DB, so the generated SQL shape is locked in:
// a bounded, oldest-first UPDATE that leases pending calls with FOR UPDATE SKIP
// LOCKED, so two workers never run the same call.
describe("buildClaimMcpCallsStatement", () => {
  it("claims a bounded, oldest-first batch of pending calls with SKIP LOCKED", () => {
    const { sql, params } = new PgDialect().sqlToQuery(buildClaimMcpCallsStatement(4));
    const text = sql.toLowerCase();

    expect(text).toContain("update");
    expect(text).toContain("job_mcp_calls");
    expect(text).toContain("status = 'running'");
    expect(text).toContain("attempts = attempts + 1");
    expect(text).toContain("claimed_at = now()");
    expect(text).toContain("status = 'pending'");
    expect(text).toContain("order by");
    expect(text).toContain("for update skip locked");
    expect(text).toContain("returning");
    expect(params).toContain(4);
  });
});

describe("toMcpCallJob", () => {
  it("maps a raw returned row", () => {
    const created = new Date("2026-10-17T10:00:00Z");
    expect(
      toMcpCallJob({
        id: "job-1",
        session_id: "sess-1",
        flow_id: "flow-1",
        node_id: "node-1",
        correlation_id: "corr-1",
        server_id: "mcp-1",
        tool_name: "search",
        arguments: { query: "x" },
        actor_id: "user-1",
        status: "running",
        attempts: 1,
        last_error: null,
        claimed_at: created,
        finished_at: null,
        created_at: created,
        updated_at: created,
      }),
    ).toEqual({
      id: "job-1",
      sessionId: "sess-1",
      flowId: "flow-1",
      nodeId: "node-1",
      correlationId: "corr-1",
      serverId: "mcp-1",
      toolName: "search",
      arguments: { query: "x" },
      actorId: "user-1",
      status: "running",
      attempts: 1,
      lastError: null,
      claimedAt: created,
      finishedAt: null,
      createdAt: created,
      updatedAt: created,
    });
  });

  it("reads timestamps a raw query returned as strings", () => {
    const job = toMcpCallJob({
      id: "job-1",
      session_id: "s",
      flow_id: "f",
      node_id: "n",
      correlation_id: "c",
      server_id: "m",
      tool_name: "t",
      arguments: {},
      actor_id: null,
      status: "running",
      attempts: 1,
      last_error: null,
      claimed_at: "2026-10-17T10:00:00.000Z",
      finished_at: null,
      created_at: "2026-10-17T10:00:00.000Z",
      updated_at: "2026-10-17T10:00:00.000Z",
    });
    expect(job.claimedAt).toEqual(new Date("2026-10-17T10:00:00.000Z"));
  });
});
