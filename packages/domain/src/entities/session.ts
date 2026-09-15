// `cancelled` is the terminal state a rejected approval drives the session to
// when the originator chooses "Close request" (no route-back).
export type SessionStatus = "active" | "complete" | "abandoned" | "cancelled";

// The statuses that mean the work is gone, not merely finished. An approval
// raised against one of these can never be acted on — deciding it would advance
// a session nobody is running — so it must not sit in an approver's queue.
// `complete` is deliberately absent: a completed session's approvals were the
// thing that completed it.
export const DISCARDED_SESSION_STATUSES: readonly SessionStatus[] = ["abandoned", "cancelled"];

export const isSessionDiscarded = (status: SessionStatus): boolean =>
  DISCARDED_SESSION_STATUSES.includes(status);

// A test run is an ordinary session carrying `mode = "test"` (ADR-048). There is
// no parallel session table and no second runner: the same repository creates
// it, the same run-turn advances it, and the same components render it. What
// differs is that it resolves its flow from the live draft rows rather than the
// pinned published snapshot, and that every production read excludes it.
export type SessionMode = "live" | "test";

// Absent means `"live"`. Every row written before test runs shipped, and every
// caller that never sets it, is a live session — so the discriminator can be
// added without back-filling or touching a single existing call site.
export const sessionMode = (session: { mode?: SessionMode }): SessionMode => session.mode ?? "live";

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
  // Optional/back-filled: absent reads as `"live"` (see `sessionMode`).
  mode?: SessionMode;
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
  // Server-side turn lease (scaling wall #3). While `activeTurnId` is set and the
  // lease is fresh, one turn is in flight and a second send is rejected with a
  // CONFLICT. The lease is self-healing: a crash mid-turn leaves the row stamped,
  // and the next claim after the lease window elapses takes over. Optional so
  // rows/fixtures created before the lease shipped still satisfy the type.
  activeTurnId?: string | null;
  activeTurnClaimedBy?: string | null;
  activeTurnClaimedAt?: Date | null;
  // Optimistic-concurrency guard for every non-lease session write (scaling wall
  // #3). Each successful update increments it; a stale expected version loses the
  // conditional update and surfaces a CONFLICT instead of silently overwriting.
  // Optional/back-filled: absent is treated as version 1.
  version?: number;
  // The operator's own estimate, in minutes, of how long this case would have
  // taken without Wayfinder — captured once the session reaches a terminal
  // state. Null when never asked or skipped; a flow's baseline is the median of
  // these, so a null is excluded rather than counted as zero.
  manualEstimateMinutes?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSession {
  flowId: string;
  userId: string;
  mode?: SessionMode;
  title?: string | null;
  currentNodeId?: string | null;
  flowVersionId?: string | null;
}
