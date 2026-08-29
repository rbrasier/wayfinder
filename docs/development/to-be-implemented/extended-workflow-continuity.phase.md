# Phase — Extended Workflow Continuity

> **⚠️ Held — the problem statement below is under challenge.**
> Review of PR #257 established that the requirement this document was written
> against is not the one the product needs. What is written here describes
> *composer-text persistence across a page reload*; the stated requirement is
> *an AI building a document across multiple model calls, larger than one
> output window can produce*. Nothing here has been adjusted toward the new
> reading — re-deriving is the job, not patching. See the tracking PR for the
> confirmation question put to @johntooth.


- **Status**: Awaiting review
- **Target version**: 0.32.0  (bump: MINOR — new `app_session_drafts` table + additive
  `app_session_step_outputs.status` column + new feature)
- **PRD**: `docs/development/prd/extended-workflow-continuity.prd.md`
- **ADRs**: ADR-051 (session drafts and step-output finalisation)
- **Depends on**: `026-operator-confirmed-step-completion` (the confirm-to-advance boundary),
  ADR-006 (flow/session schema), ADR-007 (session-scoped LangGraph), ADR-038 (step output types)

## 1. Problem

A conversational session already survives a reload — checkpoint, messages, uploads and step
outputs are all server-side, and the client reattaches over SSE with `Last-Event-ID`
(`apps/web/src/app/(user)/chats/[sessionId]/_content.tsx:287`). The unsent message does not:
it is component state (`apps/web/src/components/chat/chat-composer.tsx:26`), even though the
attachments beside it are persisted and re-fetched on mount (`chat-composer.tsx:44`).

Separately, the step rail reports position but not completeness, and whether a captured step
output is provisional is inferred from `Session.awaitingConfirmationNodeId` rather than
recorded on the output. See the PRD for full detail.

## 2. Goals

- An unsent message survives reload, tab loss and a move to another device — while it is still
  a reply to the step it was written for.
- A draft whose step has since advanced is discarded rather than restored.
- Two participants in one session keep separate unsent text.
- A step output states on itself whether it is `draft` or `final`.
- The rail shows completeness for the current step from an already-computed readiness signal.
- A session resumed with a live turn lease shows a resuming state, not an idle composer.

## 3. Non-goals

- Reopening a completed step to amend its captured output. The `draft`/`final` state is the
  groundwork; **no editing path ships here**, and the PRD records that acceptance criterion
  as knowingly unmet.
- Synthesise/extraction runs and AI-assisted flow authoring.
- Changes to per-turn context assembly (`buildSystemPrompt` is untouched).

## 4. Approach

Two independent slices that share a migration.

**Drafts.** A new `app_session_drafts` table, unique on `(session_id, user_id)`, written
through a new domain port. Deliberately *not* a column on `app_sessions`: that row is guarded
by an optimistic-concurrency `version` and a turn lease, and debounced keystroke writes must
not contend with turns (ADR-051).

The row records the `nodeId` it was composed against, and a stale draft is **discarded**: on
load, a draft whose `nodeId` no longer matches `currentNodeId` is deleted rather than
rehydrated (ADR-051). Staleness is decided in the domain by a pure `isDraftStale()`, so the
rule is testable without a session runner.

**Finalisation and completeness.** An additive `status` column on `app_session_step_outputs`,
read through a single `stepOutputStatus()` accessor that treats absent as `"final"` — the same
idiom as the existing `sessionMode()`. `confirm-step-advance` promotes `draft` → `final`. The
rail reads a persisted readiness signal rather than invoking `evaluate-step-readiness` on
render, because that use case makes a model call.

**Migrations are gated on an information-architecture investigation (step 4b).** The table and
column below are the current proposal, not a settled design — the investigation may conclude that
less is needed.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/session-draft.ts` | new | `SessionDraft` (carries `nodeId`), `NewSessionDraft`, `isDraftStale()` |
| `packages/domain/src/ports/session-draft-repository.ts` | new | `getForParticipant` / `upsert` / `clear`, Result pattern |
| `packages/domain/src/entities/session-step-output.ts` | changed | `StepOutputStatus`, `status?`, `stepOutputStatus()` |
| `packages/domain/src/entities/index.ts`, `ports/index.ts` | changed | Re-exports |
| `packages/application/src/use-cases/session/save-session-draft.ts` | new | Upsert, ownership-checked |
| `packages/application/src/use-cases/session/clear-session-draft.ts` | new | Delete on send/clear |
| `packages/application/src/use-cases/session/get-session.ts` | changed | Returns the caller's draft |
| `packages/application/src/use-cases/session/confirm-step-advance.ts` | changed | Promotes `draft` → `final` |
| `packages/adapters/src/db/schema/wayfinder.ts` | changed | `app_session_drafts`; `status` on step outputs |
| `packages/adapters/src/db/migrations/` | new | One generated migration |
| `packages/adapters/src/repositories/session-draft-repository.ts` | new | Drizzle implementation |
| `apps/web/src/server/routers/session.ts` | changed | `saveDraft`, `clearDraft` |
| `apps/web/src/components/chat/chat-composer.tsx` | changed | Rehydrate + debounced persist |
| `apps/web/src/components/layout/app-header-model.ts` | changed | `StepState` widened |
| `apps/web/src/components/chat/step-progress-rail.tsx` | changed | Completeness + draft treatment |
| `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` | changed | Resuming indicator |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — step-output status.** Write `session-step-output.test.ts` first:
   (a) `stepOutputStatus()` returns `"final"` for a row with no `status`;
   (b) returns the stored value when present. Then add `StepOutputStatus`, the optional
   `status` field and the accessor. Pure types plus one accessor — no external deps.

2. **Domain — draft entity and port.** Add `SessionDraft`, `NewSessionDraft` and
   `ISessionDraftRepository`. Type-only; no test file beyond the re-export check that
   `validate.sh` already performs.

3. **Application — draft use cases.** Write `save-session-draft.test.ts`,
   `load-session-draft.test.ts` and `clear-session-draft.test.ts` first, against an in-memory
   fake repository: (a) saving upserts for `(sessionId, userId)` and stamps the current
   `nodeId`; (b) a second participant's save does not overwrite the first's; (c) a
   non-participant is rejected with a `DomainError`; (d) clearing removes only the caller's
   row; (e) clearing a non-existent draft succeeds; (f) loading a draft whose `nodeId` matches
   returns it; (g) loading a draft whose `nodeId` has been left behind returns nothing **and
   deletes the row**, so the discard is not merely a render-time filter. Then implement.

4. **Application — finalisation.** Add `confirm-step-advance.test.ts` cases:
   (a) capture while awaiting confirmation stores `draft`; (b) confirming promotes it to
   `final`; (c) a later turn on the same node does not rewrite a `final` output — it writes a
   new draft. Then implement.

4b. **Information-architecture investigation — before any schema change is written. ✅ Complete
   (2026-08-25) — the finding is §10 below; it confirms the planned shape and pins staleness to
   `current_node_id`, ruling out the confirmation pointer explicitly.**
   This phase adds a table and a column, so their shape is settled by investigation first.
   Produce a short written finding covering:
   - **Whether a draft warrants its own table.** ADR-051 argues it does, to keep keystroke-rate
     writes off the contended `app_sessions` row. Confirm that against how the session row is
     actually written today, and check no existing table already owns per-participant session
     state that a draft belongs beside.
   - **Whether `status` belongs on `app_session_step_outputs`**, or whether draft-versus-final is
     already derivable from existing rows plus `awaiting_confirmation_node_id` — in which case
     the column is redundant and should not be added.
   - **How `node_id` on a draft relates to the session's own `current_node_id`**, so staleness is
     expressed once rather than in two places that can disagree.
   Bring the finding back before writing the migration. A conclusion that no column is needed is
   a valid and welcome outcome.

5. **Adapters — schema, migration, repository.** Add `app_session_drafts` and the `status`
   column; generate the migration (never `drizzle-kit push`) carrying:
   `-- data-impact: preserved — new table plus a defaulted column; no existing row is altered or lost`.
   Repository integration test asserts unique-constraint upsert behaviour and that an existing
   step-output row reads back as `final`.

6. **Web — composer continuity.** Component test first: the composer renders the persisted
   draft on mount, and does not flash empty before it arrives. Then wire `session.saveDraft`
   (debounced, off the turn's critical path) and `session.clearDraft` on send.

7. **Web — rail completeness and resuming indicator.** Component tests first for the widened
   `stepState()` — every existing position case unchanged, plus the new completeness and
   `draft` cases — then the rail rendering and the `activeTurnId` resuming state.

8. **Validate.** Run `./validate.sh` after each sub-component; do not proceed on a non-zero exit.

## 7. Acceptance criteria

Mirrors the PRD §10 checklist. Restated here as the build's test plan:

- [ ] Composer text survives reload; sending clears the stored draft.
- [ ] A draft written against a step the session has since left is discarded on load and its
      row deleted — it is never rendered, and never re-appears on a later load.
- [ ] Participants' drafts are isolated; a draft is visible to its author on another device.
- [ ] `stepOutputStatus()` reads absent as `"final"`; pre-existing rows are unaffected.
- [ ] Capture-while-awaiting stores `draft`; `confirm-step-advance` promotes to `final`;
      a `final` output is never rewritten.
- [ ] Rail shows completeness for the current step without triggering a model call on render.
- [ ] Resuming indicator shows while `activeTurnId` is leased and clears on SSE reattach.
- [ ] Migration applies to a populated database with no row loss.

## 8. Playwright e2e

**Qualifies — group 4 (navigation state across a page load).** Draft restoration is state
surviving a document load, which cannot be asserted in-process.

- New spec `apps/web/e2e/chat-draft-continuity.spec.ts`, named for the capability per the
  policy. No existing spec covers reload continuity in chat — `chat-composer-upload.spec.ts`
  is group 3 (file upload) — so extending one would misname it.
- Happy path: type into the composer, reload, assert the text is restored.
- Discard path: type into the composer, let the step advance, reload, assert the composer is
  empty — the browser-visible half of the staleness rule, with the deletion itself asserted in
  the application test.
- User-visible error path: send the message, reload, assert the composer is empty.
- Obeys the non-negotiables: no `test.skip()` on a self-probed condition, no `isVisible()`
  for control flow, no environment-variable gate.

**Everything else stays below the browser**: the `draft`/`final` transition is
`packages/application` (step 4), `stepOutputStatus()` is `packages/domain` (step 1), the
unique-constraint behaviour is a `packages/adapters` integration test (step 5), and the rail's
rendering is an `apps/web` component test (step 7).

## 9. Risks / open questions

- **Write volume** — debounce interval must keep the drafts table off the hot path.
- **`StepState` widening** — every rail consumer reads `stepState()`; a missed call site
  degrades the header silently. Keeping it the sole reader is the mitigation.
- **Draft staleness — decided: discard.** A draft is a reply to a specific step; once the
  session moves on, restoring it would invite the operator to send it against a question it was
  never written for. The accepted cost is real: an operator who typed at length and then let
  the step advance loses that text. The deletion is deliberate rather than a filter, so a stale
  draft cannot resurface later.
- **Completeness source** — `evaluate-step-readiness` makes a model call, so the rail must read
  a persisted signal. Where that signal is stored is settled during step 7 and may add a
  further additive column.

---

## Approved change summary (from `/new-feature`, 2026-08-24)

Extended Workflow Continuity closes the last three gaps in resuming a chat session, on top of
machinery that already survives reload. A session's unsent message is the only thing genuinely
lost today, and it becomes per-participant server-side state so it follows the operator across
devices. Conversational step outputs gain an explicit draft/final discriminator, making the
existing confirm-to-advance boundary visible in the data rather than implied by a session
column. The step rail learns to show completeness, not just position, by surfacing the
readiness signal the application layer already computes. Acceptance criterion 4 — editing
previously defined elements — is deliberately excluded.

**Scope decisions taken at planning time:**

- Surface: chat sessions only.
- Gaps closed: unsent draft persistence; draft vs finalised separation; hardened resume and
  progress indicator. **Not** closed: editing previously captured step outputs.
- Prefix corrected from `core_` to `app_` during planning: `core_sessions` is the Better Auth
  login session (`packages/adapters/src/db/schema/core.ts:50`), whereas the workflow session is
  `app_sessions` (`wayfinder.ts:150`).
- Two findings shrank the original scope: staged uploads already persist and re-fetch on mount,
  so only unsent *text* is lost; and `evaluate-step-readiness` already computes the completeness
  signal, so the work is surfacing it rather than building it.
- Decomposition: 1) domain entity + port + step-output status; 2) application use cases +
  `confirm-step-advance`; 3) adapters schema, migration, repository; 4) web composer draft
  rehydration; 5) rail completeness + resuming indicator.

---

## 10. Information-architecture finding — step 4b (2026-08-25)

Produced before any migration was drafted, as step 4b requires. Every claim below is from
the code as it stands, cited by path and line. **Outcome: the shape ADR-051 proposed survives
unchanged, with one comparison pinned down that the ADR left implicit.**

### 10.1 Does a draft warrant its own table? — **Yes**

Two independent findings, either of which is sufficient on its own.

**`app_sessions` is guarded by optimistic concurrency, so a keystroke-rate write cannot go
there.** `app_sessions.version` (`schema/wayfinder.ts:184`) is incremented by *every* non-lease
write, and a stale expected version loses the conditional update and surfaces a `CONFLICT`
rather than silently overwriting (`entities/session.ts:66-70`). A debounced draft save is a
non-lease writer. Putting it on the session row means the operator's typing and the turn
runner's own writes contend for the same version counter — the draft save either loses to the
turn, or wins and makes the turn's write fail. The contention argument ADR-051 made on
general grounds is confirmed by a specific mechanism.

**No existing table can host it.** `app_session_participants` is the only per-participant
session state, and it is unique on `(session_id, user_id)` — the exact key a draft needs. It is
still the wrong home: its own comment records that the owner is deliberately *not* stored there
(`schema/wayfinder.ts:311-314`, "the owner is not stored here — it is `app_sessions.user_id`"),
so it holds only invited collaborators and viewers. The session owner is the most common author
of a draft and has no row to hang one on. Adding one for the owner would change what the
participants table means, to make a draft fit.

**Conclusion.** New table `app_session_drafts`, unique on `(session_id, user_id)`, cascading on
session delete — as planned. No column is added to `app_sessions`.

### 10.2 Does `status` belong on `app_session_step_outputs`? — **Yes, it is not derivable**

The alternative was to derive draft-versus-final from existing rows plus
`app_sessions.awaiting_confirmation_node_id`. That derivation cannot be written, for two reasons.

**The pointer is nulled on confirm.** `ConfirmStepAdvance` sets `awaitingConfirmationNodeId: null`
on both its success paths (`confirm-step-advance.ts:73`, `:99`). Once a step is confirmed there is
no trace of which node was ever awaiting it, so a historical row cannot be classified at all —
only "the one node the session is paused on right now" is knowable.

**The table holds more than one row per node.** Step outputs are inserted unconditionally —
`create` is a bare `insert` (`drizzle-session-step-output-repository.ts:29-45`), and every call
site persists without first looking for an existing row for that node
(`capture-structured-output.ts:95`, `generate-document.ts:200`, `apply-auto-node-result.ts:125`,
`decide-approval.ts:593`). `updateFields` exists but is addressed by row `id`, not by
`(session, node)`, so it is not an upsert. A second capture on the same node therefore leaves two
rows. `awaiting_confirmation_node_id` points at a *node*, so even while it is set it cannot tell
those two rows apart — which is precisely what step 4(c) requires ("a later turn on the same node
does not rewrite a `final` output — it writes a new draft").

**Conclusion.** Add the additive `status` column, read through `stepOutputStatus()` with absent
meaning `"final"`. The column is the only place the distinction can live.

### 10.3 Where is staleness expressed? — **Once, in `LoadSessionDraft`, against `currentNodeId`**

Staleness is `draft.nodeId !== session.currentNodeId`, evaluated in the load use case, which
**deletes** the row and returns nothing. It is expressed nowhere else: the router returns what the
use case returns, and the composer renders what it is given without re-checking. A second check in
the component is the "two places that can disagree" this step was written to prevent.

ADR-051 already names `currentNodeId` as the comparison. The investigation pins down what it left
implicit: staleness must **never** be compared against `awaiting_confirmation_node_id`. A session
paused for confirmation still has `currentNodeId` equal to that node (`entities/session.ts:51-53` — `awaitingConfirmationNodeId ===
currentNodeId` is the paused state), so comparing against the confirmation pointer would delete a
draft the operator is actively typing at the moment their step completes.

`app_session_drafts.node_id` is therefore a *stamp of what the text was written against*, not a
second copy of the session's position. The session row stays the single source of truth for where
the session is.

### 10.4 Net effect on the planned migration

Unchanged: one new table, one additive defaulted column, one migration carrying
`-- data-impact: preserved — new table plus a defaulted column; no existing row is altered or lost`.
The gate did not shrink this phase. What it produced is evidence for each of the three shapes
ADR-051 asserted, and one explicit prohibition — comparing staleness against the confirmation
pointer — that would otherwise have been an easy thing to reach for mid-build.
