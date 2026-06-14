# ADR-026 — Operator-Confirmed Step Completion & Deferred Advancement

- **Status**: Proposed (scoped by `step-confirmation-toggle.prd.md`)
- **Date**: 2026-06-14

## Context

Conversational steps advance automatically the moment the AI's
`stepCompleteConfidence` reaches the threshold. The decision and its side
effects are concentrated in two places:

1. **The advance decision** — `RunTurn.persistAssistantTurn`
   (`packages/application/src/use-cases/session/run-turn.ts:121-163`): if
   `stepCompleteConfidence >= threshold`, resolve outgoing edges, pick the
   branch (single edge, or the AI's `branchChoice` on a fork), update
   `Session.currentNodeId`, write a `graphCheckpoint`, and fire the
   step-complete / session-complete notifiers.
2. **The post-advance side effects** — inline in the chat stream route's
   `execute()` (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts:227-304`):
   kick off document generation for the just-completed step, and for the new
   node generate the AI opener / dispatch a scheduled or auto node.

The threshold itself comes from `nodeConfig.advanceConfidenceThreshold ?? 90`,
and the existing **`neverDone`** flag suppresses advancement entirely by passing
`advanceThreshold = Number.POSITIVE_INFINITY` (`route.ts:219`).

`step-confirmation-toggle.prd.md` adds a per-node toggle that holds a
*completed-but-not-handed-over* step open until the operator clicks **Proceed**,
while still letting them chat. This forces two decisions: **how to represent the
paused state**, and **where the advance + side effects live** so the operator's
Proceed produces an outcome identical to auto-advance.

Constraints:

1. **The operator must keep chatting while paused.** A great deal of code keys
   off `Session.status === "active"` (the stream route's guard at `route.ts:54`,
   the composer's `disabled` at `_content.tsx:409`, polling, typing heartbeats).
   The paused state must not take the session out of `active`.
2. **Hexagonal boundary (ADR-001).** Advancement is an application use-case over
   existing ports; no framework code crosses into domain/application.
3. **No divergence from auto-advance.** Proceed must run the *same* advancement
   and the *same* side effects, or confirmation-required steps would behave
   subtly differently (missing documents, no next-step opener).
4. **Default-off, zero-impact.** With the toggle off, the bytes on the
   auto-advance path must be unchanged.

## Decision

### 1. Represent the paused state as session data, not a new status

Add a nullable `app_sessions.awaiting_confirmation_node_id uuid` column, surfaced
on the domain entity as `Session.awaitingConfirmationNodeId: string | null`.
The session stays `active`; `awaitingConfirmationNodeId === currentNodeId` is the
single source of truth for "this step is complete and waiting for the operator".

We deliberately do **not** add a new `SessionStatus` value (e.g.
`awaiting_confirmation`). A new status would ripple through every `status ===
"active"` check — the stream guard, the composer, polling, heartbeats — and the
whole point is that the session *is* still active and chattable. A dedicated
nullable field is additive and leaves those checks untouched.

We also prefer a **dedicated column over a key inside the existing
`graph_checkpoint` jsonb**. The awaiting state gates server-side writes (a
confirm must verify the session is genuinely awaiting *this* node) and benefits
from being explicit, indexable, and obvious in the schema, rather than a
soft-typed jsonb key discovered by reading code. The jsonb alternative (zero
migration) is recorded under Alternatives.

### 2. The turn sets the awaiting state instead of advancing

When `requireConfirmation` is on (and the node is not `neverDone`), the stream
route reuses the existing suppression mechanism — it passes
`advanceThreshold = Number.POSITIVE_INFINITY` to `persistAssistantTurn`, so the
turn never auto-advances. `RunTurn` is extended to also receive the *real*
threshold and the `requireConfirmation` intent: when
`stepCompleteConfidence >= realThreshold` it sets `awaitingConfirmationNodeId =
currentNodeId` (once; subsequent turns over the same node are idempotent and do
not clear it). The assistant message and its confidence are persisted exactly as
today, so the confidence UI is unchanged.

### 3. A shared advance path, reused by Proceed

Extract the post-advance side effects from the route into a single reusable
helper (alongside the existing `turn-helpers.ts`) so both callers run the same
code:

- **Auto path** (toggle off): `persistAssistantTurn` advances, then the route
  runs the shared side-effect helper — exactly as today, just refactored.
- **Confirm path** (Proceed): a new `ConfirmStepAdvance` application use-case
  performs the advancement block — resolve edges (honouring the pinned flow
  version, `run-turn.ts:61`), recompute the branch choice for a fork, update the
  session, clear `awaitingConfirmationNodeId`, write the `graphCheckpoint`
  (stamped with `confirmedByUserId` / `confirmedAt`), and fire the step-complete
  notifier — then the confirm endpoint runs the *same* shared side-effect helper.

Branch choice is **recomputed at confirm time** rather than stored at threshold
time, because the operator may have chatted further; this reuses
`buildBranchChoicePrompt` and costs one model call on Proceed for forked steps
only. If no branch resolves, the confirm returns a Result that the UI maps to
the existing manual branch-override path (`session.overrideBranch`), so a stuck
fork is never a silent failure.

### 4. UI: a pinned card that does not lock the composer

`_content.tsx` renders a small `ConfirmStepCard` when
`awaitingConfirmationNodeId === currentNodeId`, in the same region as
`ApprovalGate` and the branch-override banner — **but unlike `ApprovalGate` it
does not set the composer's `disabled`**. The card mirrors `DocumentCard`'s
visual language (`document-card.tsx`: centered, bordered white card, same shadow)
at a smaller size, with a single primary **Proceed** action calling
`session.confirmStep`. `MessageFeed` suppresses the auto-advance `MilestonePill`
for a step that is awaiting confirmation, since the step has not actually
completed.

## Alternatives considered

- **New `SessionStatus = "awaiting_confirmation"`.** Conceptually clean but
  forces the session out of `active`, breaking the "keep chatting" requirement
  and rippling through every status guard. Rejected.
- **Awaiting state inside `graph_checkpoint` jsonb (no migration).** Cheaper, but
  soft-typed and easy to miss; the confirm gate reads better against an explicit
  column. Kept as the fallback if a migration is undesirable for a given release.
- **Store the branch choice when the threshold is first reached, replay on
  Proceed.** Avoids the extra model call, but goes stale the moment the operator
  chats further, which is the whole point of the feature. Recompute-on-confirm is
  more correct.
- **Fold straight into `advanced-step-config` (`confidenceProgression.behaviour`,
  ADR-014/015).** That phase is unbuilt and gates the behaviour behind a
  flow-level Advanced mode, and it never resolved the chat-stream UX. Shipping a
  standalone per-node toggle now delivers the operator-facing value without
  waiting on the larger surface. When advanced-step-config lands, its
  `behaviour` selector should read/write this same `requireConfirmation` flag and
  reuse this ADR's awaiting state and `ConfirmStepCard` — not a parallel
  mechanism.

## Consequences

**Positive**

- The session stays `active` and fully chattable while paused — no status-guard
  churn.
- Proceed and auto-advance share one advancement + side-effect path, so
  confirmation-required steps generate documents and open the next step
  identically; no behavioural drift.
- Default-off and additive: existing flows and the auto-advance bytes are
  unchanged; the new column backfills `null`.
- Reuses the proven `neverDone → Infinity` suppression and the
  `overrideBranch` advance precedent rather than inventing new control flow.

**Negative**

- Forked confirmation-required steps incur one extra model call (branch
  recompute) on Proceed.
- Extracting the route's inline side effects into a shared helper is a real
  refactor of a hot path; it must be covered by tests asserting the auto path is
  unchanged.
- A second, smaller pinned card now shares the chat footer with `ApprovalGate`
  and branch-override; their mutual exclusivity (a step is conversational *or*
  approval) keeps them from colliding, but the footer's stacking must be checked.
- Collaborative sessions can race two Proceeds; the confirm use-case must no-op
  safely when the session has already advanced past the awaiting node.
