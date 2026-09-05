# PRD — Flow Memory (Self-Improving Flows)

- **Status**: Draft — awaiting `/doc-review`
- **Date**: 2026-09-05
- **Author**: Solo / Claude Code
- **Target version**: **0.35.0** — **MINOR** (new feature + additive schema).
  Provisional; allocated for real at `/doc-review`. See §9 for the line it is
  allocated against.

## 1. Problem

A Wayfinder flow is written once and then runs unchanged for months. Everything
that would tell its author how to make it better is already in the database and
nothing reads it: a step that advanced at 62% confidence, an approver's comment
routing work back for the fourth time this quarter, a generated field the
operator overwrote in eight of the last ten documents, a step that takes nine
turns when every other step takes three, a turn where retrieval returned nothing
and the model guessed.

The author sees none of it. They find out a step is weak when someone complains,
and the only remedy is to open the canvas and rewrite an `aiInstruction` from
memory and intuition. For a business analyst who writes no code — the persona
this product exists for — that is the difference between a flow that compounds in
quality and one that quietly decays.

## 2. Users / Personas

- **Business Analyst / Policy Owner (Flow Owner)** — the primary user. Owns the
  flow, wants it to get better, has no appetite for reading transcripts to work
  out why. Needs to be told what the flow is getting wrong, with evidence, and to
  fix it with one click.
- **Procurement Officer / HR Manager (operator)** — the indirect beneficiary.
  Never sees this feature. Experiences it as fewer redundant questions, fewer
  corrections after a document generates, fewer approval bounce-backs.
- **Admin** — needs assurance that nothing changed a live flow's behaviour
  without a named human deciding it, and that the evidence behind a lesson
  respects the same visibility and retention rules as the sessions it came from.
- **Knowledge owner / SME** — receives the knowledge-gap half of the output as
  ordinary curation work, in the loop they already use.

## 3. Goals

- A published flow accumulates **observations** — typed, evidence-bearing signals
  written from sessions that have already ended — with no author involvement.
- Those observations are periodically distilled into **lessons**: short,
  human-readable statements scoped to **one step of one flow**, each carrying the
  sessions that produced it.
- A lesson does nothing until the flow owner **accepts** it. Accept, reject and
  retire are recorded in `core_audit_log` with the deciding user.
- An accepted `guidance` or `efficiency` lesson is injected into that step's
  system prompt as a `<learned_guidance>` block, and takes effect on the **next
  turn of every session on that flow**, including sessions already in flight.
- A `knowledge_gap` lesson is **never** injected into a prompt. It raises an item
  in the existing knowledge-curation loop instead.
- The flow config screen shows the owner, in one panel: how the flow is actually
  being used, and what it has learned — with the panel collapsible to nothing so
  it never competes with the canvas.

## 4. Non-goals

- **Automatic application.** No lesson ever changes behaviour without a human
  accepting it. There is no "auto-accept above threshold" setting in this version.
- **Rewriting the author's prompt.** Memory sits beside `aiInstruction`; it never
  edits, replaces or reorders it.
- **Cross-flow learning.** A lesson belongs to one node of one flow. There is no
  shared lesson library and no transfer between flows or organisations.
- **Per-operator or per-group personalisation.** A lesson applies to every session
  on the flow or not at all.
- **Routing / branch-rule learning.** Branch overrides are a real signal and are
  deliberately deferred (§11).
- **Extraction flows.** `flowType = "extraction"` (ADR-033) has no node graph to
  attach a lesson to. Guided flows only.
- **Proving a lesson helped.** No A/B, no shadow comparison, no before/after
  verdict. The panel reports usage, not causation.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `FlowObservation` | `packages/domain/src/entities/flow-observation.ts` | new | `{ id, flowId, nodeId, sessionId, kind, detail, occurredAt, createdAt, updatedAt }`. One captured signal. |
| `ObservationKind` | `packages/domain/src/entities/flow-observation.ts` | new | `"field_corrected" \| "low_confidence_completion" \| "excess_turns" \| "redundant_question" \| "change_requested" \| "knowledge_gap" \| "abandoned_at_step"`. |
| `ObservationDetail` | `packages/domain/src/entities/flow-observation.ts` | new | Per-kind payload (`jsonb`): the field key and before/after for `field_corrected`, the confidence for `low_confidence_completion`, the approver's comment for `change_requested`. |
| `FlowLesson` | `packages/domain/src/entities/flow-lesson.ts` | new | `{ id, flowId, nodeId, kind, statement, status, evidenceCount, firstSeenAt, lastSeenAt, acceptedByUserId, acceptedAt, supersedesLessonId, createdAt, updatedAt }`. |
| `LessonKind` | `packages/domain/src/entities/flow-lesson.ts` | new | `"guidance" \| "efficiency" \| "knowledge_gap"`. Decides where the lesson goes when accepted — prompt, prompt, or KB. |
| `LessonStatus` | `packages/domain/src/entities/flow-lesson.ts` | new | `"proposed" \| "accepted" \| "rejected" \| "retired"`. Only `accepted` has any runtime effect. |
| `ResolvedLesson` | `packages/domain/src/entities/flow-lesson.ts` | new | `{ statement }` — the prompt-facing projection, mirroring `ResolvedSkill`. Nothing else reaches the model. |
| `FlowUsageStats` | `packages/domain/src/entities/analytics.ts` | existing file, new type | `{ total, completed, inProgress, stale, abandoned }`, computed from `AnalyticsSessionRow[]`. |
| `IFlowObservationRepository` | `packages/domain/src/ports/flow-observation-repository.ts` | new | `createMany`, `listUndistilledByFlow`, `listByLesson`. |
| `IFlowLessonRepository` | `packages/domain/src/ports/flow-lesson-repository.ts` | new | `listByFlow`, `listAcceptedByFlow`, `findById`, `createProposed`, `setStatus`, `retireForMissingNodes`. |
| `ILessonDistiller` | `packages/domain/src/ports/lesson-distiller.ts` | new | `distil({ nodeName, nodeInstruction, observations, existingStatements }) -> Result<{ candidates: LessonCandidate[] }>`. Proposes only — it can never write `accepted`. |
| `DocumentEditSummary` | `packages/domain/src/entities/document-edit-summary.ts` | existing | Already computes the before/after diff a `field_corrected` observation needs. Reused, unchanged. |
| `ApprovalChangeRequest` | `packages/domain/src/entities/approval-change-request.ts` | existing | Already resolves the outstanding change request and its comment. Reused, unchanged. |
| `AnswerFeedback` | `packages/domain/src/entities/answer-feedback.ts` | existing | The destination for a `knowledge_gap` lesson (ADR-028's curation loop). Reused, unchanged. |

## 6. User stories

1. As a **flow owner**, I open my published flow's config screen and see how it
   is actually being used — total chats, completed, in progress, stale,
   abandoned — without leaving the canvas.
2. As a **flow owner**, I see a list of lessons the system has proposed, each
   naming the step it applies to and how many sessions support it.
3. As a **flow owner**, I click a lesson and the panel expands over the canvas to
   show the full statement and the sessions behind it, so I can judge it on
   evidence rather than take it on faith.
4. As a **flow owner**, I accept a lesson and the step's prompt gains it
   immediately — including for the twelve sessions already running on that flow.
5. As a **flow owner**, I reject a lesson that misreads what happened, and it
   never comes back.
6. As a **flow owner** with a crowded canvas, I collapse the panel out of sight
   entirely and reopen it later from an icon on the canvas.
7. As an **SME**, I see recurring knowledge gaps arrive in the curation queue I
   already work, rather than as prompt text nobody can trace back to a source.
8. As an **admin**, I can answer "why did this flow start saying that, and who
   decided it" from the audit log alone.

## 7. Pages / surfaces affected

- **`/flows/[id]/config`** — gains a right-hand **Flow Memory panel**, rendered
  only when `flow.status === "published"`. A draft has no live sessions to learn
  from, so the panel is absent rather than empty.
- **Panel — three states.**
  - *Hidden*: the panel is gone and the canvas is full width. Reopened from a
    single icon button pinned to the **top right of the canvas viewport**.
  - *Narrow* (the default on a published flow): a fixed-width rail. Header shows
    the five usage stat tiles; body shows the lesson list — `proposed` first with
    an evidence-count badge, then `accepted`, each with its step name and a
    one-line statement.
  - *Expanded*: clicking a lesson widens the drawer to **~85% of the viewport**,
    overlaying the canvas behind a scrim, showing the full statement, the step it
    attaches to, its linked evidence sessions, and **Accept** / **Reject**.
    Dismissed by clicking the scrim or the minimise button, returning to *narrow*
    with the canvas viewport and selection untouched.
- **Stat tiles** — `total`, `completed`, `in progress`, `stale`, `abandoned`.
  `stale` is derived, never stored: an `active` session whose `updated_at` is
  older than the staleness window (default 14 days, an `admin_system_settings`
  key). `cancelled` sessions count under `abandoned`, matching
  `DISCARDED_SESSION_STATUSES`.
- **tRPC** — `flowMemory.panel` (stats + lessons in one call),
  `flowMemory.lesson` (one lesson with its evidence), `flowMemory.accept`,
  `flowMemory.reject`. All gated on `canUserEditFlow`.
- **Chat / session UI** — unchanged. The operator sees no indication that a
  lesson is in play; the effect is in the reply, not the chrome.
- **Knowledge curation (`kb_answer_feedback` surfaces)** — an accepted
  `knowledge_gap` lesson raises an item here. No new screen.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `ai_flow_observations` | NEW — `id`, `flow_id`, `node_id`, `session_id`, `kind`, `detail jsonb`, `occurred_at`, `distilled_at`, `created_at`, `updated_at` | yes (`ai_`) |
| `ai_flow_lessons` | NEW — `id`, `flow_id`, `node_id`, `kind`, `statement`, `status`, `evidence_count`, `first_seen_at`, `last_seen_at`, `accepted_by_user_id`, `accepted_at`, `supersedes_lesson_id`, `created_at`, `updated_at` | yes (`ai_`) |
| `ai_flow_lesson_evidence` | NEW — `id`, `lesson_id`, `observation_id`, `created_at`, `updated_at`; unique `(lesson_id, observation_id)` | yes (`ai_`) |

Indexes: `ai_flow_observations (flow_id, node_id)` and a partial index on
`distilled_at IS NULL` for the distillation sweep; `ai_flow_lessons
(flow_id, status)` for the panel read, and `(flow_id, node_id, status)` for the
prompt-time read; `ai_flow_lesson_evidence (lesson_id)`.

`session_id` is nullable and set null on session delete: retention or a deletion
may remove the session while the lesson it contributed to remains accepted and in
force. Evidence then reads as "the session behind this has since been deleted",
which is honest — silently retiring an in-force lesson because a row aged out
would be worse.

`ai_` rather than `app_` for all three: these are model-derived artefacts of the
AI subsystem, sitting with `ai_usage_events`, and they are deliberately **not**
part of a flow's authoring config — a flow export (ADR-049) carries no lessons.

One generated migration, additive `CREATE TABLE` / `CREATE INDEX` only. No
`-- data-impact:` declaration is required: nothing drops or rewrites rows, and no
constraint can fail against existing data. Generated migration only — never
`drizzle-kit push`.

No change to `app_sessions`, `app_flows` or `app_flow_versions`. Every panel
stat, `stale` included, is derived at query time.

## 9. Architectural decisions

- **Introduces ADR-057** — *Flow memory is observation → proposed lesson →
  owner-accepted memory.* Records the separation of raw signal from distilled
  statement, the propose-only distiller, the evidence threshold, the human accept
  gate, and the split of `knowledge_gap` away from the prompt into KB curation.
- **Introduces ADR-058** — *Accepted lessons resolve live, not from the flow
  version snapshot.* Records why memory is deliberately outside the pinned
  `app_flow_versions` snapshot that ADR-015 makes every session read, and what
  that costs.
- **Assumes** ADR-052 and `032-normalisation-overlay-and-ai-propose-confirm` for
  the propose-confirm shape this reuses; **ADR-031** for the skills block the
  `<learned_guidance>` block sits beside; **ADR-016** for the prompt-cache
  discipline that decides where in the prompt it goes; **ADR-028** for the
  knowledge-curation loop it feeds; **ADR-033 (immutable audit log)** for the
  accept/reject record; **ADR-048** for the `mode = "test"` discriminator that
  excludes test runs from capture. Where an ADR number is used twice in
  `docs/development/adr/`, it is cited here by filename.
- **Branch and version**: builds on **`main`**, currently **0.34.0**, so a MINOR
  bump lands on **0.35.0**, with the implemented doc going to
  `docs/development/implemented/alpha-3/v0.35.0/` — the routing `CLAUDE.md`
  specifies for a new feature.

## 10. Acceptance criteria

- [ ] Observations are written only for sessions in a terminal state
      (`complete`, `abandoned`, `cancelled`) and only where
      `sessionMode(session) === "live"`; a test run produces none — asserted
      against the capture use case, not the router.
- [ ] Each of the seven `ObservationKind` values is produced by a named source,
      and each has a unit test proving it fires on the signal and not otherwise.
- [ ] Re-running capture over an already-captured session writes no duplicate
      rows — capture is idempotent per `(session_id, node_id, kind)`.
- [ ] The distiller is called only for `(flowId, nodeId)` groups with at least
      the evidence threshold (default 3) of undistilled observations of one kind.
- [ ] Every lesson the distiller returns is written with `status = "proposed"`;
      no code path lets a distiller output reach `accepted` — enforced by the
      repository's `createProposed` accepting no status argument.
- [ ] A distiller response is validated before persistence: a candidate naming a
      node that is not the one it was asked about, or an unknown `kind`, is
      reported as a reject rather than written.
- [ ] Each proposed lesson has at least one `ai_flow_lesson_evidence` row, and
      `evidenceCount` equals the number of linked observations.
- [ ] Only `accepted` lessons of kind `guidance` or `efficiency` render into
      `buildSystemPrompt`; `proposed`, `rejected`, `retired` and every
      `knowledge_gap` lesson produce no prompt text — one test per exclusion.
- [ ] The `<learned_guidance>` block renders after `<skills>` and before
      `<instructions>`, above every per-turn block, so the prompt-cache
      discipline of ADR-016 is preserved — asserted on the rendered string.
- [ ] Injected lessons per node are capped (default 5, most recently accepted
      first); accepting a sixth does not silently grow the prompt.
- [ ] A session already in flight picks up a newly accepted lesson on its next
      turn, with no restart and no change to `flowVersionId`.
- [ ] A lesson applies in a `mode = "test"` session, so an author can try one
      before accepting it — capture is excluded, application is not.
- [ ] Accepting a `knowledge_gap` lesson creates an `AnswerFeedback` row and no
      prompt text.
- [ ] Accept, reject and retire each write a `core_audit_log` entry naming the
      lesson, the flow, the node and the deciding user.
- [ ] A lesson whose `node_id` is absent from the flow's current nodes is retired
      by the next distillation pass and stops rendering immediately.
- [ ] Accept and reject are refused for a user who fails `canUserEditFlow` —
      asserted at the use case, not only the router.
- [ ] The memory panel is absent on a `draft` flow and present on a `published`
      one.
- [ ] The panel's five stat tiles match `computeFlowUsageStats` over the flow's
      live sessions, with `stale` derived from the configured window and
      `cancelled` counted under `abandoned`.
- [ ] The panel collapses to hidden, restores from the canvas top-right icon, and
      the chosen state persists across a reload for that user.
- [ ] Clicking a lesson expands the drawer to ~85% of the viewport over a scrim;
      clicking the scrim or the minimise control returns it to narrow with canvas
      viewport and node selection intact.
- [ ] Panel and drawer are component-tested; no Playwright spec is added — none of
      this falls into the six groups in `docs/guides/e2e-test-policy.md`.
- [ ] Architecture boundaries intact — `domain` dependency-free, ports in domain,
      Result at every boundary, no `-- data-impact:` needed for an additive
      migration. `VERSION` matches `package.json#version` at `0.35.0`;
      `./validate.sh` passes.

## 11. Out of scope / future work

- Learning routing accuracy from branch overrides (`override-branch.ts`) and from
  which branch a change request bounced off.
- Extraction-flow memory — schema-hint lessons for `flowType = "extraction"`.
- A cross-flow lesson library, and sharing lessons between organisations.
- Measuring whether an accepted lesson helped: a before/after on turns-to-advance
  and correction rate per lesson, which would let a bad lesson be found rather
  than merely suspected.
- Auto-accept for a lesson kind an organisation has decided to trust.
- Surfacing lessons in the node config modal itself, so an author sees a step's
  memory while editing its instruction.
- Per-operator or per-group scoping of a lesson.

## 12. Risks / open questions

- **A confident wrong lesson is worse than no lesson.** A distiller that reads
  three coincidental corrections as a rule produces text the model will follow
  and the author will trust. Mitigated by three independent defences: the
  evidence threshold, the visible receipts in the expanded drawer, and the accept
  gate. None of them is proof, and the residual risk is real — an owner who
  accepts without reading has automated their own mistakes.
- **Prompt bloat and instruction conflict.** Accumulated lessons compete with the
  author's own `<instructions>` for the model's attention, and two accepted
  lessons can contradict each other. Mitigated by the per-node cap and by
  `supersedesLessonId`. Open: whether the distiller should be shown existing
  accepted statements so it proposes supersessions rather than near-duplicates —
  the phase doc assumes yes (`existingStatements` on the port); confirm at review.
- **Evidence carries real session content.** A `field_corrected` observation
  stores a before/after of a real value. Observations inherit the flow's
  visibility, are visible only to those who pass `canUserEditFlow`, and are swept
  by the same retention and legal-hold rules as the session they came from. A
  lesson's *statement*, however, is model-written prose that can restate a
  specific value — that is a genuine leak path into every future prompt on the
  flow, and the accept gate is the only thing standing in front of it. The
  distiller prompt instructs against restating values; the reviewer is the
  enforcement.
- **Distillation cost.** A periodic model call per flow with new observations,
  bounded by a batch cap, attributed through `ai_usage_events` and counted against
  budgets like any other spend. Open: the sweep cadence — the phase doc proposes
  daily, which is cheap and slow enough that nobody watches a lesson appear.
- **Live resolution vs. the version snapshot.** ADR-058's subject and the
  sharpest trade-off here: a session pinned to flow version 4 can be running
  under a lesson accepted after version 7 was published. That is the intended
  behaviour — memory that could not reach a running session would be nearly
  useless — but it does mean a session's prompt is no longer fully reconstructible
  from its `flowVersionId` alone. Mitigated by the audit trail carrying the
  accept time, so a prompt can be reconstructed from `flowVersionId` plus the
  lesson set as at that moment.
- **The `stale` threshold is a guess.** 14 days is a judgement call with nothing
  behind it. It is a system setting so it can be corrected without a deploy.
- **Nothing measures success.** This version deliberately ships without a way to
  tell an improving flow from a decaying one. If lessons turn out to hurt, the
  panel will not say so — the follow-up in §11 is the answer, and it is not in
  this version.
