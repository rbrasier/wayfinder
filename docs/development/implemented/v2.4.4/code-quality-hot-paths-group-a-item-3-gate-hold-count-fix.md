# Implementation Summary — Fix: gate-hold count over bounded tail (v2.4.4)

- **Version**: 2.4.4 (**PATCH** — a regression fix. Adds one internal
  repository port method as plumbing for the fix; no schema change, no
  migration, no new feature, no API/UI surface change).
- **Date**: 2026-07-10
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group A
  item 3** follow-up (the bounded turn read shipped in v2.4.0).

## The regression

v2.4.0 made the chat stream route's `dbMessages` a **bounded 20-message tail**
(`GetSessionForTurn.messagesTail`) instead of the full transcript. But the
route still fed that tail to `countGateHoldsOnNode(dbMessages, currentNodeId)`
(`route.ts`), which bounds the readiness gate against a livelocking grader
(v1.58.5, `MAX_GATE_HOLDS = 1` — the gate goes advisory after a **single**
prior hold on the node).

Because the hold count now only saw the last 20 messages, a node that
accumulated **more than 20 messages between its first gate-hold and its next
threshold crossing** lost that hold from the window: `priorGateHolds` read 0,
the gate was **not** treated as already-held, and it surfaced the node's gaps a
**second** time. A narrow, self-recovering re-opening of the exact livelock the
v1.58.5 fix closed — the v2.4.0 commit's "No behaviour change to any turn"
claim did not hold for this path.

## The fix

The hold count must be taken over the node's **full history**, not the tail —
but without reintroducing an unbounded per-turn transcript read.

- `packages/domain/src/ports/session-message-repository.ts` — new
  `listStepAssistantMessages(sessionId, nodeId)`: the step-anchored assistant
  messages for **one node**, chronological.
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` —
  `buildStepAssistantMessagesStatement` + the method. Deliberately a **plain,
  jsonb-free** filtered scan (`session_id`, `step_node_id`, `role = 'assistant'`,
  `ORDER BY seq`). The OUTSTANDING-key check stays in TS, so no new jsonb SQL
  idiom is introduced — the query is one node's turns, cheap next to the
  transcript.
- `packages/application/src/use-cases/session/get-session-for-turn.ts` — the new
  read joins the existing parallel batch (no added turn latency) and the result
  gains `currentNodeAssistantMessages`. The use case stays a pure data-returner;
  it has no knowledge of the gate marker.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — feeds
  `currentNodeAssistantMessages` (full history) to the **unchanged**
  `countGateHoldsOnNode` helper. The gate marker (`OUTSTANDING_CONTEXT_KEY`) and
  the counting logic stay entirely in the app layer where they were.

The two other bounded-tail reads introduced in v2.4.0 (the
`dbMessages.filter(role === "user").length === 0` first-turn title checks) were
reviewed and left as-is: a false positive needs 20 consecutive non-user
messages at the tail, implausible in alternating chat, and its only effect is a
redundant title regeneration.

## Files changed

- `packages/domain/src/ports/session-message-repository.ts` — new port method.
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` —
  statement builder + method.
- `packages/adapters/src/repositories/drizzle-session-message-repository.test.ts`
  — SQL-shape test: node/role scoped, ordered by seq, **no** `contextGathered`.
- `packages/application/src/use-cases/session/get-session-for-turn.ts` — parallel
  read + `currentNodeAssistantMessages` on `SessionTurnDetail`.
- `packages/application/src/use-cases/session/session.test.ts` — fake gains the
  method; new test proving the count source is the node's full history (25
  messages) while the tail stays bounded (20), so an older hold survives.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — gate-hold count over
  full node history.
- `VERSION`, `package.json` — 2.4.3 → 2.4.4.

## Migrations run

None.

## Tests added

- **Unit (adapters)** — `buildStepAssistantMessagesStatement` renders a
  node/role-scoped `seq`-ordered scan and touches no jsonb.
- **Unit (application)** — `GetSessionForTurn` returns the current node's
  assistant messages over full history (25) even when the tail is bounded to 20,
  and an OUTSTANDING-marked hold from the first turn survives in that set.

## Verification still owed (needs Postgres — see handoff)

The counting logic and SQL **shape** are verified in-sandbox, but the actual
`listStepAssistantMessages` query result was **not** run against Postgres here
(no DB in this environment). Before merge, confirm against a real seeded session
that the query returns the node's assistant messages and that a node driven to a
gate-hold reports `priorGateHolds === 1` on a later turn even after >20 messages.

## Known limitations / follow-ups

- The fix reads one node's assistant messages per turn. A node with a very large
  number of turns transfers those rows; a future SQL-side `COUNT` (guarded by a
  verified jsonb existence check) could avoid it, but that idiom needs a live DB
  to validate and was intentionally not introduced blind.
