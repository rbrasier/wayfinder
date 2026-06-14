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
  // The flow version this chat is pinned to (ADR-015). Resolved to the latest
  // published version at session start; the runner reads that snapshot, not the
  // live rows, so the chat stays stable across later edits/publishes/restores.
  // Optional for sessions created before versioning shipped (back-filled).
  flowVersionId?: string | null;
  // The node this session is paused on awaiting operator confirmation (ADR-026).
  // `awaitingConfirmationNodeId === currentNodeId` is the single source of truth
  // for "this step is complete and waiting for the operator to Proceed". Null
  // (or absent on rows created before the feature) means not awaiting.
  awaitingConfirmationNodeId?: string | null;
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
  flowVersionId?: string | null;
}
