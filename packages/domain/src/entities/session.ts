// `cancelled` is the terminal state a rejected approval drives the session to
// when the originator chooses "Close request" (no route-back).
export type SessionStatus = "active" | "complete" | "abandoned" | "cancelled";

// In-flight auto-node execution awaiting an n8n callback, keyed by correlationId
// on Session.pendingExecutions. sentAt makes a stuck execution observable.
export interface PendingExecution {
  nodeId: string;
  status: "pending";
  sentAt: string;
}

export type PendingExecutions = Record<string, PendingExecution>;

export interface Session {
  id: string;
  flowId: string;
  userId: string;
  status: SessionStatus;
  title: string | null;
  currentNodeId: string | null;
  graphCheckpoint: Record<string, unknown> | null;
  pendingExecutions: PendingExecutions;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSession {
  flowId: string;
  userId: string;
  title?: string | null;
  currentNodeId?: string | null;
}
