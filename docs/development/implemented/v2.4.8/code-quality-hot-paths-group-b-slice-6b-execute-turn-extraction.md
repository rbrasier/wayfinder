# v2.4.8 — Group B slice 6b: extract `executeTurn` from the stream route

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group B**, item 6 — second slice (6b-lite). **Bump**: PATCH (2.4.7 → 2.4.8).
No schema change; a behaviour-preserving extraction of the turn orchestration
out of the route handler, plus the first deterministic test of the pass/hold
seam.

## Change

Building on 6a (the `TurnStreamWriter` port, v2.4.7), the ~250-line turn
orchestration that lived inline in the stream route's `createDataStreamResponse`
`execute` callback moves into a single cohesive unit,
`executeTurn(input: ExecuteTurnInput)` in
`apps/web/.../stream/execute-turn.ts`. It runs everything from persisting the
user message through the quota gate, the streamed reply, the confidence
annotation, the pre-generation cross-check gate (hold vs pass), the branch
choice, the assistant-turn persistence, the advance side effects, and the
best-effort title — writing to the client only through the `TurnStreamWriter`
port.

`route.ts` shrinks from **535 to 287 lines** and is now a thin shell: auth,
rate-limit, body validation, the bounded turn read, access control, the turn
lease claim, building the system prompt + per-turn context, then constructing
one `DataStreamTurnWriter` and calling `executeTurn`. It still owns the lease
lifecycle (heartbeat interval + `finally` release) and the HTTP response. The
`MAX_GATE_HOLDS` constant and the `documentLabel` helper moved with the
orchestration.

This is **6b-lite**: the orchestration is a named, testable unit that depends on
the writer port and the existing container ports, but it stays in `apps/web`
rather than moving to `packages/application`. The blocker for the full
application-layer lift is `applyAdvanceSideEffects` and its subtree
(`generateDocument`, `generateInitialMessage`, `dispatchAutoNode`,
`dispatchScheduledNode`), which all take the app container and would have to move
first — a larger tranche tracked as 6c/6b-full.

## Tests

- `execute-turn.test.ts` (new, 4 cases): the first deterministic test of the
  turn control flow, driving `executeTurn` with a fake `ILanguageModel`
  (growing partial stream), fake use cases/repos, and a recording
  `TurnStreamWriter`:
  - **quota block** short-circuits before any model call — writes the notice,
    persists a system message, never streams, never persists an assistant turn;
  - **gate-skipped** (below threshold) streams the reply, emits a `confidence`
    annotation, no `cross-checking` annotation, persists the assistant turn;
  - **cross-check PASS** toggles `cross-checking` on/off, streams the pass note
    behind an `endBubble` boundary (new bubble), persists the assistant turn,
    then persists the pass note as a system message;
  - **cross-check HOLD** persists the overruled reply, streams the follow-up
    behind a boundary, and does **not** advance (no `persistAssistantTurn`, no
    pass note).
- Full stream suite: **67 passing** (63 prior + 4 orchestration). `./validate.sh`
  19/19.

## End-to-end verification

Because the e2e suite mocks `/api/chat/[id]/stream` at the HTTP boundary (see
6a), a live turn is the real end-to-end check. Drove a fresh "New Hire" session
in the browser: the user message submitted, a contextual assistant reply
streamed into a new bubble, and the confidence annotation rendered — confirming
the route correctly builds `ExecuteTurnInput` and the whole extracted path runs
through the `TurnStreamWriter` port to the client. (Field-by-field, the route's
`executeTurn` call maps all 25 inputs to the values the inline callback used;
`tsc` type-checks the mapping and the live turn confirms the runtime wiring.)

## Next (still open under item 6)

- **6c / E14**: narrow the route's remaining direct `container.repos.*` reach
  (claimTurn/heartbeatTurn/releaseTurn, users.findById, sessionUploads,
  sessionMessages) by giving `executeTurn` (and a small lease helper) explicit
  port dependencies instead of the whole container.
- **6b-full**: relocate `executeTurn` and the advance/auto/scheduled/doc subtree
  into `packages/application` as a true `ExecuteTurn` use case.
