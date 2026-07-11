import {
  err,
  ok,
  type ISessionRepository,
  type IUserRepository,
  type Result,
  type Session,
} from "@rbrasier/domain";

// Outcome of a claim attempt. On a successful claim the caller gets the leased
// session; on a contended one it gets the holder's display name (or null) so it
// can attribute the rejection without touching the user repository itself.
export type ClaimTurnOutcome =
  | { claimed: true; session: Session }
  | { claimed: false; heldByName: string | null };

export interface ClaimTurnInput {
  sessionId: string;
  turnId: string;
  userId: string;
  // Staleness window after which a stamped-but-crashed turn can be taken over.
  leaseSeconds: number;
}

// The server-side turn lease (scaling wall #3), as one cohesive unit: claim the
// single active turn, extend it while a long turn runs, and release it. Claiming
// also resolves the current holder's name on a contended attempt, so the caller
// (the stream route) no longer reaches into the session and user repositories
// directly for the lease.
export class TurnLease {
  constructor(
    private readonly sessions: ISessionRepository,
    private readonly users: IUserRepository,
  ) {}

  async claim(input: ClaimTurnInput): Promise<Result<ClaimTurnOutcome>> {
    const claimResult = await this.sessions.claimTurn(
      input.sessionId,
      input.turnId,
      input.userId,
      input.leaseSeconds,
    );
    if (claimResult.error) return err(claimResult.error);

    if (claimResult.data.claimed) {
      return ok({ claimed: true, session: claimResult.data.session });
    }

    const holderId = claimResult.data.heldBy;
    if (!holderId) return ok({ claimed: false, heldByName: null });

    // A missing/failed holder lookup must not turn a clean 409 into a 500 — fall
    // back to an unattributed name.
    const holderResult = await this.users.findById(holderId);
    const heldByName = holderResult.error ? null : holderResult.data?.name ?? null;
    return ok({ claimed: false, heldByName });
  }

  heartbeat(sessionId: string, turnId: string): Promise<Result<void>> {
    return this.sessions.heartbeatTurn(sessionId, turnId);
  }

  release(sessionId: string, turnId: string): Promise<Result<void>> {
    return this.sessions.releaseTurn(sessionId, turnId);
  }
}
