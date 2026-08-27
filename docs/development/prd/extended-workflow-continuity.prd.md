# PRD — Extended Workflow Continuity

- **Status**: Draft
- **Date**: 2026-08-24
- **Author**: rbrasier
- **Target version**: 0.32.0  (bump: MINOR — new `app_session_drafts` table plus an additive
  `app_session_step_outputs.status` column, and new operator-visible behaviour)

## 1. Problem

An operator part-way through a conversational session can lose work by doing nothing more
than reloading the page. The session itself survives — messages, uploads, checkpoint and
step outputs are all persisted server-side — but the message being typed is held only in
React state, so a refresh, a crashed tab, or a switch to another device discards it.

Two smaller continuity gaps sit alongside it. The step rail reports *position* but not
*completeness*, so an operator cannot tell whether the current step is nearly done or barely
started. And whether a step's captured data is provisional or committed is implied by a
column on the session (`awaiting_confirmation_node_id`) rather than recorded on the output
itself, so nothing downstream can distinguish a draft capture from a confirmed one.

## 2. Users / Personas

- **Operator** (procurement officer, HR manager, ops lead) — runs a multi-step
  AI-guided session over hours or days, across reloads and devices. Needs to return
  to exactly the state they left.
- **Flow author** — reviews how far a session progressed and how complete each step is
  when diagnosing a flow that stalls.

## 3. Goals

- An operator who reloads mid-compose finds their unsent message still in the composer.
- An unsent message follows the operator across devices, not just across reloads in one browser.
- The step rail shows completeness for the current step, not just complete/current/pending.
- A step output records on itself whether it is `draft` or `final`.
- A session resumed while a turn is still leased shows a resuming state instead of an idle composer.

## 4. Non-goals

- **Editing previously defined elements during refinement.** Deliberately excluded from this
  phase (see §11); the acceptance criterion covering it is not satisfied here.
- Synthesise / extraction runs (`/synthesise/[id]/runs/[runId]`) — chat sessions only.
- AI-assisted flow authoring at `/flows/[id]/config`.
- Any change to how the AI rebuilds context per turn — `buildSystemPrompt` already reassembles
  gathered context, uploads, retrieved chunks and skills on every turn and is left untouched.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `SessionDraft` | `packages/domain/src/entities/session-draft.ts` | new | One unsent message per `(sessionId, userId)`, scoped to the `nodeId` it was written against |
| `ISessionDraftRepository` | `packages/domain/src/ports/session-draft-repository.ts` | new | Result pattern; `getForParticipant` / `upsert` / `clear` |
| `SessionStepOutput` | `packages/domain/src/entities/session-step-output.ts` | existing | Gains `status?: StepOutputStatus` |
| `StepOutputStatus` | same file | new | `"draft" \| "final"`; absent reads as `"final"` |
| `StepState` | `apps/web/src/components/layout/app-header-model.ts` | existing | Widened to carry completeness alongside position |

## 6. User stories

1. As an operator, I can type a long reply, get called away, close the tab, and return to
   find my text still in the composer, so that I never retype work.
2. As an operator, I can start composing on my laptop and finish on another machine, so that
   my draft is not trapped in one browser.
3. As an operator, I can see how complete the current step is, so that I know whether to keep
   going or move on.
4. As an operator, I can tell which steps hold provisional data and which are committed, so
   that I trust what the workflow has captured.
5. As an operator returning while the AI is still mid-turn, I see that it is picking up where
   it left off rather than an idle composer that invites a duplicate send.

## 7. Pages / surfaces affected

- `/chats/[sessionId]` — composer rehydrates the unsent draft; rail gains completeness;
  resuming indicator while `activeTurnId` is leased.
- tRPC: `session.saveDraft` (added), `session.clearDraft` (added), `session.get` (returns the
  caller's draft and per-step completeness).
- `apps/web/src/components/chat/chat-composer.tsx` — draft rehydration and debounced persistence.
- `apps/web/src/components/chat/step-progress-rail.tsx` and
  `apps/web/src/components/layout/app-header-model.ts` — completeness rendering.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_session_drafts` | NEW — `id`, `session_id`, `user_id`, `node_id`, `body`, `created_at`, `updated_at`; unique `(session_id, user_id)` | yes (`app_`) |
| `app_session_step_outputs` | add column `status text not null default 'final'` | n/a (existing `app_` table) |

The prefix is `app_`, not `core_`: `core_sessions` is the Better Auth login session
(`packages/adapters/src/db/schema/core.ts:50`), while the workflow session is `app_sessions`
(`packages/adapters/src/db/schema/wayfinder.ts:150`). Session-scoped workflow state belongs
with the latter.

**The information-architecture investigation these were gated on is complete** — phase doc §10,
written before any migration was drafted (step 4b). It confirmed the shape above unchanged, with
evidence for each part: `app_sessions` carries an optimistic-concurrency `version` bumped by every
non-lease write, so a debounced draft save cannot live there; `app_session_participants`
deliberately excludes the owner, so it cannot host one either; and draft-versus-final is not
derivable, because the confirmation pointer is nulled on confirm and step outputs are inserted
unconditionally, so two rows can share a node. Staleness is compared against `current_node_id`,
never `awaiting_confirmation_node_id`.

One generated migration (never `drizzle-kit push`). It is additive throughout — a new table,
and a defaulted column that cannot fail on existing rows — so it declares:

```
-- data-impact: preserved — new table plus a defaulted column; no existing row is altered or lost
```

The unique constraint is on a brand-new, empty table, so the `ADD CONSTRAINT … UNIQUE` hazard
class cannot bite here; the declaration still records that judgement.

## 9. Architectural decisions

- **New:** ADR-051 — session drafts are per-participant rows, and step-output finalisation is
  recorded on the output rather than inferred from the session.
- **Assumes:** `026-operator-confirmed-step-completion` (the confirm-to-advance boundary this
  promotes a draft across), ADR-006 (flow/session schema), ADR-007 (session-scoped LangGraph),
  ADR-038 (step output types).

## 10. Acceptance criteria

- [ ] Typing in the composer and reloading the page restores the exact text.
- [ ] A draft whose `nodeId` no longer matches the session's `currentNodeId` is discarded on
      load, not restored, and the stored row is deleted.
- [ ] Sending a message clears the stored draft; the composer is empty after the turn.
- [ ] Two participants in one session never see each other's unsent text.
- [ ] A draft written on one browser is present when the same user opens the session elsewhere.
- [ ] `stepOutputStatus()` returns `"final"` for a row written before this phase.
- [ ] A step output captured while `awaitingConfirmationNodeId` is set is stored as `draft`.
- [ ] `confirm-step-advance` promotes that output to `final`, and a `final` output is never
      rewritten by a later turn on the same node.
- [ ] The rail shows completeness for the current step, sourced from `EvaluateStepReadinessOutput`.
- [ ] Loading a session with `activeTurnId` leased shows the resuming indicator, which clears
      once the SSE stream reattaches.
- [ ] The migration applies to a database holding existing sessions and step outputs with no
      row loss.

## 11. Out of scope / future work

- **Modifying previously defined elements during refinement** — reopening a completed step to
  amend its captured `SessionStepOutput`. The `draft`/`final` discriminator added here is the
  groundwork for it, but no editing path ships in this phase, and the corresponding acceptance
  criterion is knowingly unmet.
- Extending continuity to synthesise/extraction runs and to AI-assisted flow authoring.
- Surfacing draft state to other participants (presence / "someone is typing" beyond the
  existing typing indicator).

## 12. Risks / open questions

- **Write volume.** Persisting on every keystroke would make the drafts table a hot path; the
  phase doc specifies a debounce, and the write must stay off the turn's critical path.
- **`StepState` widening.** Every rail consumer reads `stepState()`; a missed call site degrades
  the header silently rather than failing loudly. Keeping `stepState()` the sole reader is the mitigation.
- **Draft staleness — decided: discard.** A draft is scoped to the step it was written against.
  When the session has advanced past that step, the draft is deleted rather than restored,
  because text written as a reply to one question must not be offered as an answer to another.
  The accepted cost is that an operator who typed at length and then let the step advance loses
  that text.
- **Completeness cost.** `evaluate-step-readiness` runs a model call; the rail must read a
  cached/persisted signal rather than triggering evaluation on render.
