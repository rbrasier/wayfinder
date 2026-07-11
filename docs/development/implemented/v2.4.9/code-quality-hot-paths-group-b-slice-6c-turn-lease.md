# v2.4.9 — Group B slice 6c / E14: extract the `TurnLease` use case

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group B**, item 6 (slice 6c) — the E14 repo-reach narrowing that falls out of
the `ExecuteTurn` extraction. **Bump**: PATCH (2.4.8 → 2.4.9). No schema change;
a new application use case + rewiring the stream route to it.

## Problem (E14)

After 6a/6b the stream route was a thin auth + lease + HTTP shell, but the
**turn lease** (scaling wall #3) was still hand-plumbed against raw repositories
inside the route: `sessions.claimTurn`, a follow-up `users.findById` to attribute
the 409 to the holder, `sessions.heartbeatTurn` on a timer, and
`sessions.releaseTurn` in the teardown. The claim path in particular carried real
branching logic (claimed vs held, holder-name resolution, graceful degradation
on a failed lookup) sitting directly in the HTTP handler.

## Change

- **New use case** (`packages/application/src/use-cases/session/turn-lease.ts`):
  `TurnLease` wraps `ISessionRepository` + `IUserRepository` and owns the lease
  as one cohesive unit:
  - `claim({ sessionId, turnId, userId, leaseSeconds })` →
    `Result<{ claimed: true; session } | { claimed: false; heldByName }>`. It
    resolves the holder's name itself (and degrades a failed/absent lookup to
    `null` so a contended claim stays a clean 409, never a 500).
  - `heartbeat(sessionId, turnId)` / `release(sessionId, turnId)` delegate to the
    session repository, so the whole lease concern lives behind one collaborator.
- **Container**: `useCases.turnLease = new TurnLease(sessions, users)`.
- **Route**: the claim block drops from ~15 lines of repo calls + holder lookup
  to a single `turnLease.claim(...)`; the heartbeat timer and the teardown
  release call `turnLease.heartbeat/release`. The route no longer imports the
  session/user repos for the lease at all. The 409 copy stays in the route (a
  presentation concern); the use case returns only `heldByName`.

The route's remaining direct `container.repos.*` reach is now just the per-turn
**context build** (`sessionUploads.listBySession`, `users.findById` for the
profile) and the teardown **seq reconciliation** (`sessionMessages.latestBySession`)
— setup/teardown responsibilities, not the lease. Folding those into a
`buildTurnContext` step is a later, larger slice.

## Tests

- `turn-lease.test.ts` (new, 7 cases): claim returns the leased session; a held
  claim resolves the holder's name; a null holder id skips the lookup; a failed
  holder lookup degrades to `null` (still a clean contended outcome); a claim
  repo error propagates; heartbeat and release delegate to the session repo.
- Full suite green: `./validate.sh` 19/19 (7 `TurnLease` + the 67 stream unit
  tests among them). Typecheck clean across `application` and `web`.

## Next (still open under item 6)

- **6b-full**: relocate `executeTurn` and the advance/auto/scheduled/doc subtree
  into `packages/application` as a true `ExecuteTurn` use case (the subtree still
  takes the app container, which blocks the lift).
- **Optional**: a `buildTurnContext` use case for the route's remaining setup
  reads, if the setup block is decomposed further.
