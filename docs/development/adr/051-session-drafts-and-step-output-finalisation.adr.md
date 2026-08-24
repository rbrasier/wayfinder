# ADR-051 — Session Drafts Are Per-Participant Rows, and Finalisation Lives on the Step Output

- **Status**: Proposed (scoped by `extended-workflow-continuity.prd.md`)
- **Date**: 2026-08-24
- **Builds on**: ADR-006 (flow/session schema), ADR-007 (session-scoped LangGraph),
  `026-operator-confirmed-step-completion` — the confirm-to-advance boundary this ADR
  records on the output itself, ADR-038 (step output types)

## Context

A conversational session already survives a page reload. The row carries the graph
checkpoint, the current node and the pinned flow version; messages, uploads and step
outputs are separate persisted rows; and the client reattaches losslessly:

```typescript
const source = new EventSource(`/api/sessions/${sessionId}/events`);
```

— `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx:287`, which reconnects with
`Last-Event-ID` for replay.

One thing does not survive. The composer's text is ordinary component state:

```typescript
value,
onChange,
```

— `apps/web/src/components/chat/chat-composer.tsx:26`

Uploads attached in the same composer *do* survive, because they are written server-side
immediately and re-fetched on mount (`chat-composer.tsx:44`). So the composer is already
half-persistent: the attachment survives, the sentence explaining it does not.

Two decisions follow from closing that gap.

### Where an unsent message belongs

A session is not single-player. `app_session_participants` exists, and a session can be
shared. So "the session's draft" is the wrong shape — an unsent message belongs to the
person typing it, not to the session.

Nor can it live on `app_sessions` as a column: one column cannot hold two participants'
unsent text, and widening it to JSONB keyed by user turns a row every turn already
contends on into a keystroke-rate write target. `app_sessions` is guarded by an
optimistic-concurrency `version` and a turn lease; adding a debounced draft write to that
row would make drafts and turns fight for the same conditional update.

### What "finalised" means for a step output

Whether a step's captured data is provisional is currently inferred from the *session*:

```typescript
awaitingConfirmationNodeId?: string | null;
```

— `packages/domain/src/entities/session.ts`, where
`awaitingConfirmationNodeId === currentNodeId` is the single source of truth for "this step
is complete and waiting for the operator to Proceed".

That works for the one step the session is paused on, and only while it is paused. It
cannot answer the question for any *other* step, and it answers nothing at all once the
session has advanced — the column moves on, and the output row it described keeps no record
of whether it was ever confirmed. Anything downstream reading `app_session_step_outputs`
sees rows it cannot classify.

## Decision

**1. An unsent message is a row in a new `app_session_drafts` table, unique on
`(session_id, user_id)`, scoped to the step it was written against.**

Per-participant by construction. Server-side, so a draft follows the operator to another
device rather than being trapped in one browser's storage. A separate table, so
keystroke-rate writes never touch `app_sessions` and never contend with the turn lease or
the session's version guard. Writes are debounced client-side and sent off the turn's
critical path; sending or clearing the message deletes the row.

`localStorage` was the cheaper option and is rejected: it fails the cross-device goal
outright, and the codebase uses it only for view preferences
(`apps/web/src/components/admin/field-report-section.tsx`), never for user-authored content.

The row records the `nodeId` it was composed against. **A stale draft is discarded, not
restored**: on load, a draft whose `nodeId` no longer matches the session's `currentNodeId` is
deleted rather than rehydrated. A draft is a reply to a specific question, and once the session
has moved past that question the text is no longer an answer to what is on screen. Restoring it
would invite the operator to send it anyway, against a step it was never written for.

**2. `SessionStepOutput` carries its own `status: "draft" | "final"`.**

The value is read through a single accessor:

```typescript
export const stepOutputStatus = (output: { status?: StepOutputStatus }): StepOutputStatus =>
  output.status ?? "final";
```

Absent reads as `"final"`, exactly as `sessionMode` treats an absent `mode` as `"live"`.
Every row written before this ADR was captured at step end under the pre-existing
confirm-to-advance flow, so `"final"` is the value that preserves their meaning, and the
column ships with that default — no back-fill, no touched row, and no call site that must
change to keep working.

Capture while the session is awaiting confirmation writes `draft`; `confirm-step-advance`
promotes it to `final`. A `final` output is never rewritten by a later turn on the same
node — refinement writes a new draft instead, so a confirmed capture is immutable once
committed.

The session column stays as it is. `awaitingConfirmationNodeId` remains the source of truth
for *which step the runner is paused on*; the output's `status` records *what happened to a
given capture*. They answer different questions and neither is derived from the other.

## Consequences

- Draft text becomes user-authored content at rest, inside the session's own retention and
  legal-hold scope. A draft is deleted with its session by the existing cascade.
- The drafts table takes a write per debounce interval per typing participant — bounded by
  concurrent typists, not by session count, and isolated from the contended session row.
- `app_session_step_outputs` gains a classifiable status, which is the groundwork for
  reopening a completed step to amend it. That editing path is explicitly **not** built here
  (see the PRD's §11); this ADR only makes the state representable.
- A draft is scoped to the step it was written against, so it cannot resurface against a
  question it was never a reply to. The cost is a genuine loss: an operator who typed a long
  message, let the step advance, and came back finds nothing. That is accepted as the lesser
  harm — restoring text written for a question that is no longer on screen invites the operator
  to send an answer to the wrong step, and a wrong answer sent confidently is worse than a
  blank composer.
- Two accessors (`stepOutputStatus`, alongside the existing `sessionMode`) now encode
  "absent means the legacy value". That idiom is deliberate and consistent — it is what lets
  additive columns ship without back-fills.
