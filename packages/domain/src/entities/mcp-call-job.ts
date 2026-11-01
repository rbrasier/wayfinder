// One queued MCP node call (ADR-062 §3). The node's turn records the pending
// execution and enqueues this row; a worker makes the call and applies the
// result, so the turn never waits on a slow source.
export type McpCallJobStatus = "pending" | "running" | "succeeded" | "failed";

export interface McpCallJob {
  readonly id: string;
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly correlationId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  // The session user the call is made for — the worker has no request scope, so
  // the audit actor travels on the row.
  readonly actorId: string | null;
  readonly status: McpCallJobStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly claimedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewMcpCallJob {
  readonly sessionId: string;
  readonly flowId: string;
  readonly nodeId: string;
  readonly correlationId: string;
  readonly serverId: string;
  readonly toolName: string;
  readonly arguments: Record<string, unknown>;
  readonly actorId: string | null;
}
