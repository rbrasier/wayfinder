# ADR-057 — Flow Memory Is Observation → Proposed Lesson → Owner-Accepted Memory

- **Status**: Proposed (scoped by `flow-memory.prd.md`)
- **Date**: 2026-09-05
- **Builds on**: ADR-031 (skills as author-attached prompt instructions), ADR-052
  (an AI proposal is a draft requiring explicit activation),
  `032-normalisation-overlay-and-ai-propose-confirm` (propose, validate, confirm),
  ADR-028 (frontline feedback → SME curation),
  `033-immutable-audit-log-and-legal-hold` (the accept record)

## Context

Wayfinder already collects everything needed to know whether a flow is working,
and reads none of it for that purpose:

- `stepCompleteConfidence` is written on every assistant turn and used once, to
  decide whether the step advances. A step that advances at 62% is indistinguishable
  afterwards from one that advanced at 95%.
- `DocumentEditSummary` computes exactly which generated fields a human changed
  and to what — built so an originator can see what an approver did, then discarded.
- `outstandingChangeRequests` resolves an approver's comment into a routing
  instruction, uses it for one regeneration, and lets it fall out of scope.
- `kb_answer_feedback` captures "this answer was wrong" from the frontline, and
  routes it to a chunk. It has no equivalent for "this *step* was wrong".

The author, meanwhile, edits `aiInstruction` from intuition. There is no path from
what happened in a hundred sessions to what the flow says on the hundred-and-first.

The obvious shape — have a model read the sessions and rewrite the prompt — is
exactly the shape this product is positioned against. Wayfinder's claim is a
governed, auditable workflow for a non-technical operator. A flow whose
instructions drift because a model decided they should is not that, whatever the
drift's quality.

There is already a settled answer to "AI produced something, a human owns it".
ADR-052 states it for schema proposals; `032` states it for normalisation
clusters, down to the detail that a proposer's output is validated and rejects are
reported rather than materialised. Both are the same three-step shape: propose,
validate, confirm. This ADR is that shape applied to a fourth thing — a flow's own
behaviour — and the interesting decisions are the ones where it does not fit.

The first is durability. ADR-052 could make a proposal thread-scoped scratchpad
state with no table, because a schema proposal matters only to the conversation
arguing it out. A lesson is the opposite: it is *accumulated*, it is evidence about
sessions that ended weeks apart, and its whole value is that it outlives every
conversation. It needs storage, and so does the evidence, or "why does it say
that?" has no answer.

The second is that two very different things were being called one thing. "The
operator corrected the supplier name in eight of ten documents" is a fact about
what happened. "Ask for the supplier's registered legal name, not its trading
name" is a claim about what to do. Storing only the second loses the receipts;
storing only the first leaves the author to do the reading. They are separate
records with separate lifecycles.

## Decision

**1. An observation is a captured fact; a lesson is a claim. They are separate
records.**

`ai_flow_observations` holds one typed signal each — `field_corrected`,
`low_confidence_completion`, `excess_turns`, `redundant_question`,
`change_requested`, `knowledge_gap`, `abandoned_at_step` — scoped to
`(flow_id, node_id)` and pointing at the session that produced it. It is derived
mechanically, has no model in its path, and is never shown as advice.

`ai_flow_lessons` holds the distilled statement. `ai_flow_lesson_evidence` joins
the two, so every lesson can show precisely which observations produced it, and
the author can open the sessions behind it. A lesson with no evidence rows is a
bug, not a lesson.

The consequence worth stating: the observation table stays useful even if the
distiller is turned off, replaced, or judged untrustworthy. The facts are not
entangled with the model that read them.

**2. Capture runs on terminal sessions only, and never on test runs.**

Observations are written when a session reaches `complete`, `abandoned` or
`cancelled` — not mid-session. A step that looks slow at turn four is often fine
by turn six, and an in-flight session has no outcome to attribute anything to.
Capture is idempotent per `(session_id, node_id, kind)`, so re-running it over an
already-captured session is a no-op rather than a second vote.

`mode = "test"` sessions (ADR-048) are excluded from capture entirely. An author
deliberately probing a step's failure modes would otherwise manufacture the
evidence for a lesson about the failure they were provoking.

The reverse does not hold: accepted lessons **do** apply in test sessions. An
author must be able to try a lesson before accepting one like it, and the test
runner is the only place to do that. Excluded from capture, included in
application — the asymmetry is deliberate.

**3. The distiller proposes and can do nothing else.**

`ILessonDistiller.distil(...)` returns candidates. The repository method that
writes them, `createProposed`, takes no status argument, so there is no call site
— present or future — at which a distiller's output can be written as `accepted`.
This is the `ISeedProposer` discipline from ADR-052 made structural rather than
conventional.

Output is validated before persistence, per `032`: a candidate naming a node other
than the one the distiller was asked about, or carrying an unknown kind, is a
reported reject. The distiller is shown the node's existing accepted statements so
it can propose a supersession rather than a near-duplicate of something already in
force.

**4. A lesson is proposed only once several sessions agree.**

A candidate is distilled only from a group of at least the evidence threshold
(default 3) undistilled observations of one kind on one node. One bad session is
noise. This is the cheapest defence against confident nonsense and the one that
costs nothing at review time.

**5. Only `accepted` lessons of kind `guidance` or `efficiency` reach a prompt.**

Accepted lessons render as a `<learned_guidance>` block in `buildSystemPrompt`,
placed after `<skills>` and before `<instructions>`: in the stable region, above
every per-turn block, so the prompt-cache discipline of ADR-016 holds. They sit
beside the author's instruction and never rewrite it — the same relationship
skills already have (ADR-031), for the same reason. The prompt-facing projection
is `ResolvedLesson { statement }`, mirroring `ResolvedSkill`, so nothing but the
statement can reach the model.

Injected lessons are capped per node (default 5, most recently accepted first).
Without a cap, a flow that has been running for two years arrives at the model as
a wall of accumulated advice competing with its own instructions.

**6. A `knowledge_gap` lesson never enters a prompt.**

"The model did not know the current mileage rate" is not fixed by telling the
model to be more careful. It is fixed by putting the mileage rate in the knowledge
base. Accepting a `knowledge_gap` lesson raises an item in the ADR-028 curation
loop — the path an SME already works — and produces no prompt text at all.

Folding this into prompt guidance was the tempting mistake: it would have been one
mechanism instead of two, and it would have papered a knowledge problem over with
an instruction, permanently, in a place no SME looks.

**7. Accept, reject and retire are audited; a lesson has no other way to change
state.**

Each transition writes a `core_audit_log` entry naming the lesson, flow, node and
deciding user. Only a user who passes `canUserEditFlow` may decide, checked in the
use case rather than only the router. `retired` is the one machine-driven
transition — a lesson whose node no longer exists in the flow is retired by the
next distillation pass — and it is audited identically.

There is no auto-accept, and no setting that enables one. That is the decision, not
an unimplemented feature.

## Consequences

- "Why did this flow start saying that, and who decided it" is answerable from the
  audit log plus the evidence join, for every statement in every prompt.
- Two tables and a join carry data that grows with session volume. Observations
  are the bulk of it; they are swept with the sessions they came from.
- The distiller can be replaced, or run offline, without touching capture,
  application, or a single stored fact.
- Lessons are not authoring config: a flow export (ADR-049) carries none, and an
  imported flow starts with no memory. This is a real limitation — a flow shared
  between deployments cannot carry what it learned — and it is the price of
  keeping evidence, which is tenant-specific and privacy-bearing, out of an
  export archive.
- A model-written `statement` is prose that can restate a specific value seen in a
  session, and once accepted it is in every future prompt on that flow. The
  distiller is instructed against it; the accept gate is the enforcement. This is
  the sharpest residual risk in the design and is stated as such in the PRD.
- Nothing here measures whether an accepted lesson helped. The design can tell an
  author what the flow learned; it cannot yet tell them whether it improved.
