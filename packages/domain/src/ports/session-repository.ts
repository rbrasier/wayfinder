import type { Session, NewSession, PendingExecutions, SessionStatus } from "../entities/session";
import type { Result } from "../result";

// Opaque cursor for keyset pagination. Callers hand it back unchanged; the
// adapter encodes/decodes. Kept as `string` at the port so the domain does
// not commit to a specific serialisation.
export type SessionListCursor = string;

export interface SessionListPageOptions {
  // Rows to return. Defaults are set at the caller level; the adapter clamps
  // to a hard maximum so a huge query cannot single-handedly starve the pool.
  limit: number;
  // Opaque cursor from the previous page's `nextCursor`. When omitted, the
  // first page is returned.
  cursor?: SessionListCursor;
}

export interface SessionListPage<T> {
  items: T[];
  // Non-null when a next page exists; hand back verbatim to fetch it.
  nextCursor: SessionListCursor | null;
}

export interface SessionUpdate {
  status?: SessionStatus;
  title?: string | null;
  currentNodeId?: string | null;
  awaitingConfirmationNodeId?: string | null;
  graphCheckpoint?: Record<string, unknown> | null;
  pendingExecutions?: PendingExecutions;
  // When set, the update only applies if the row still carries this version;
  // otherwise it returns a CONFLICT domain error (optimistic concurrency). Omit
  // for the last-writer-wins behaviour the chat path relies on the turn lease for.
  expectedVersion?: number;
}

// Outcome of an attempt to claim the single active turn on a session.
export type ClaimTurnResult =
  | { claimed: true; session: Session }
  // Someone else already holds a fresh lease; `heldBy` is their user id so the
  // caller can attribute the 409 ("Alex's turn is in progress").
  | { claimed: false; heldBy: string | null };

export interface ISessionRepository {
  create(input: NewSession): Promise<Result<Session>>;
  findById(id: string): Promise<Result<Session | null>>;
  listByUser(userId: string): Promise<Result<Session[]>>;
  listAll(): Promise<Result<Session[]>>;
  // Keyset-paginated variants. Sort is newest-first on (created_at DESC, id
  // DESC); items respect the `limit`; `nextCursor` is non-null iff at least
  // one more row exists after `items`. The additive contract lets the client
  // adopt pagination at its own pace — the existing full-list methods stay.
  listByUserPage(
    userId: string,
    options: SessionListPageOptions,
  ): Promise<Result<SessionListPage<Session>>>;
  listAllPage(options: SessionListPageOptions): Promise<Result<SessionListPage<Session>>>;
  update(id: string, patch: SessionUpdate): Promise<Result<Session>>;
  // Atomically take the turn lease if it is free or expired. `leaseSeconds` is
  // the staleness window after which a stamped-but-crashed turn can be taken over.
  claimTurn(
    id: string,
    turnId: string,
    userId: string,
    leaseSeconds: number,
  ): Promise<Result<ClaimTurnResult>>;
  // Re-stamp the lease so a long turn does not expire under a slow doc-gen; only
  // the current holder (matching `turnId`) may extend it.
  heartbeatTurn(id: string, turnId: string): Promise<Result<void>>;
  // Clear the lease. A no-op if `turnId` is no longer the holder, so a released
  // stale turn never clears a newer claim.
  releaseTurn(id: string, turnId: string): Promise<Result<void>>;
}
