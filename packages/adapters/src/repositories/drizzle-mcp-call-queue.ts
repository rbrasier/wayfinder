import {
  domainError,
  err,
  ok,
  type IMcpCallQueue,
  type McpCallJob,
  type McpCallJobStatus,
  type NewMcpCallJob,
  type Result,
} from "@wayfinder/domain";
import { and, eq, lt, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { job_mcp_calls } from "../db/schema/job";

// A raw `RETURNING` row: the driver hands timestamps back as strings there, as
// Date objects through the query builder.
type Timestamp = Date | string;
export interface McpCallJobRow {
  id: string;
  session_id: string;
  flow_id: string;
  node_id: string;
  correlation_id: string;
  server_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  actor_id: string | null;
  status: McpCallJobStatus;
  attempts: number;
  last_error: string | null;
  claimed_at: Timestamp | null;
  finished_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

const toDate = (value: Timestamp): Date => (value instanceof Date ? value : new Date(value));
const toOptionalDate = (value: Timestamp | null): Date | null => (value === null ? null : toDate(value));

export const toMcpCallJob = (row: McpCallJobRow): McpCallJob => ({
  id: row.id,
  sessionId: row.session_id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  correlationId: row.correlation_id,
  serverId: row.server_id,
  toolName: row.tool_name,
  arguments: row.arguments,
  actorId: row.actor_id,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
  claimedAt: toOptionalDate(row.claimed_at),
  finishedAt: toOptionalDate(row.finished_at),
  createdAt: toDate(row.created_at),
  updatedAt: toDate(row.updated_at),
});

// Atomic claim: one UPDATE leases a bounded, oldest-first batch, selecting it
// with FOR UPDATE SKIP LOCKED so two workers never run the same call.
export const buildClaimMcpCallsStatement = (limit: number): SQL => sql`
  UPDATE ${job_mcp_calls}
  SET status = 'running', attempts = attempts + 1, claimed_at = now(), updated_at = now()
  WHERE id IN (
    SELECT id FROM ${job_mcp_calls}
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *
`;

// The `job_mcp_calls` queue (ADR-062 §3). Never throws.
export class DrizzleMcpCallQueue implements IMcpCallQueue {
  constructor(private readonly db: Database) {}

  async enqueue(job: NewMcpCallJob): Promise<Result<McpCallJob>> {
    try {
      const [row] = await this.db
        .insert(job_mcp_calls)
        .values({
          session_id: job.sessionId,
          flow_id: job.flowId,
          node_id: job.nodeId,
          correlation_id: job.correlationId,
          server_id: job.serverId,
          tool_name: job.toolName,
          arguments: job.arguments,
          actor_id: job.actorId,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Insert returned no row."));
      return ok(toMcpCallJob(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to queue the MCP call.", cause));
    }
  }

  async claimPending(limit: number): Promise<Result<McpCallJob[]>> {
    try {
      const rows = await this.db.execute(buildClaimMcpCallsStatement(limit));
      return ok((rows as unknown as McpCallJobRow[]).map(toMcpCallJob));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to claim queued MCP calls.", cause));
    }
  }

  async markSucceeded(id: string): Promise<Result<void>> {
    return this.finish(id, "succeeded", null);
  }

  async markFailed(id: string, message: string): Promise<Result<void>> {
    return this.finish(id, "failed", message);
  }

  async listStaleRunning(claimedBefore: Date): Promise<Result<McpCallJob[]>> {
    try {
      const rows = await this.db
        .select()
        .from(job_mcp_calls)
        .where(and(eq(job_mcp_calls.status, "running"), lt(job_mcp_calls.claimed_at, claimedBefore)));
      return ok(rows.map(toMcpCallJob));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list stale MCP calls.", cause));
    }
  }

  private async finish(id: string, status: "succeeded" | "failed", lastError: string | null): Promise<Result<void>> {
    try {
      await this.db
        .update(job_mcp_calls)
        .set({ status, last_error: lastError, finished_at: new Date(), updated_at: new Date() })
        .where(eq(job_mcp_calls.id, id));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to record the MCP call's outcome.", cause));
    }
  }
}
