import type { McpCallJob, NewMcpCallJob } from "../entities/mcp-call-job";
import type { Result } from "../result";

// The `job_mcp_calls` queue (ADR-062 §3).
export interface IMcpCallQueue {
  enqueue(job: NewMcpCallJob): Promise<Result<McpCallJob>>;
  // Moves up to `limit` pending rows to running, oldest first. Concurrent
  // claimers never receive the same row.
  claimPending(limit: number): Promise<Result<McpCallJob[]>>;
  markSucceeded(id: string): Promise<Result<void>>;
  markFailed(id: string, message: string): Promise<Result<void>>;
  // Running rows claimed before the cut-off: a worker died mid-call.
  listStaleRunning(claimedBefore: Date): Promise<Result<McpCallJob[]>>;
}
