# PRD — Document Composition

> **Rewritten in full.** This PRD previously described a different problem —
> an unsent chat message lost on reload. That reading was withdrawn on
> PR #262 after review on PR #257 established that the entity model it
> produced (`SessionDraft` / `app_session_drafts`) does not survive contact
> with the real requirement. Nothing from the old reading carries forward
> except §10 of the phase doc (the write-contention finding, which was never
> really about drafts). This rewrite reflects the reframed problem statement
> proposed in reply on PR #262, pending @rbrasier's confirmation.

- **Status**: Draft — pending confirmation from @rbrasier on PR #262 that the
  reframed problem statement is correct
- **Date**: 2026-08-30
- **Author**: johntooth (rewritten via `/new-feature` once PR #257/#262
  review established the original problem statement was wrong at the root)
- **Target version**: 0.33.0 (bump: MINOR — two new `app_` tables, new admin
  config fields, new feature surface)

## 1. Problem

A single LLM call has a fixed output ceiling. When a generated document
needs to be larger or more detailed than one call can produce, that ceiling
shows up two ways: the document has more *sections* than one call's output
window can hold (breadth), or a section is present but under-covered because
the model ran out of room before treating it properly (depth).

Today, `GenerateDocument` already splits work across calls on the *input*
side — it batches template fields and extracts each batch with a separate
model call to stay under context limits
(`packages/application/src/use-cases/document/generate-document.ts:173-186`).
But the document itself is rendered deterministically, in one shot, from
already-resolved field values — `documentGenerator.generate()`
(`generate-document.ts:93-97`). There is no path anywhere in the codebase for
an LLM to write free-form document content across more than one call. This
PRD adds that path.

## 2. Users / Personas

- **Operator** (procurement officer, HR manager, ops lead) — runs a
  document-generation flow and needs the finished document to be larger or
  more detailed than one model call could produce, without personally
  triggering every incremental step.
- **Flow author** — decides how a document's plan is structured and how much
  human checkpointing the flow requires, appropriate to what it produces.
- **Admin** — sets a deployment-wide floor on how much checkpointing is
  required, and tunes how the composition loop is orchestrated (how much
  context each call sees, how many attempts a section gets).

## 3. Goals

- A document plan (ordered sections, each with a target depth) is agreed
  before composition starts, and is small enough for a human to read in full
  regardless of the finished document's size.
- Once approved, the AI composes the document across as many model calls and
  sessions as the plan requires, without a human triggering each pass.
- Every segment states how it was produced (`FieldProvenance`, reused from
  ADR-053), so the operator can tell a model-authored section from a
  mechanically populated one.
- An admin or flow designer can set how often the process checkpoints for
  human confirmation — from every segment to fully autonomous.
- Regardless of the checkpoint setting, an operator viewing a composition
  always sees how many segments were written and how many model calls it
  took. Autonomy is never silent.

## 4. Non-goals

- **Editing a finalized segment's content by hand.** Future work; the
  `status` model on a segment is groundwork for it, but no editing path
  ships here.
- **Chat-transcript / composer-draft continuity** (an unsent message
  persisting across reload). If that problem still exists, it needs its own
  PRD — folding it back into this one is exactly the scope-mixing that
  produced the wrong entity model the first time.
- **Any change to the extraction-flow batch engine** (ADR-033). Composition
  is a session-scoped sibling, not a replacement — see §9 and §11.
- **Locator-resolved ("verbatim") segments against an external retrieval
  source.** No such source is integrated yet; see §11.
- **A fuller statistical-sampling review surface** (weighted sampling,
  aggregate dashboards) — phase 2, not this PRD.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `DocumentComposition` | `packages/domain/src/entities/document-composition.ts` | new | Plan, resolved checkpoint granularity, status, model-call count |
| `DocumentPlanSection` | same file | new | `key`, `title`, `targetDepth` |
| `CompositionSegment` | same file | new | One unit of composed content; carries provenance |
| `CompositionCheckpointGranularity` | same file | new | `"per_segment" \| "per_milestone" \| "end_of_run" \| "autonomous"`, closed set |
| `FieldProvenance` / `FieldSourceRef` / `FieldConfidence` | `packages/domain/src/entities/field-provenance.ts` | existing, reused | ADR-053; unchanged by this PRD |
| `DocumentGenerationConfig` | `packages/domain/src/entities/runtime-config.ts` | existing, extended | Gains 3 orchestration fields — §9 |
| `IDocumentCompositionRepository` | `packages/domain/src/ports/document-composition-repository.ts` | new | Result pattern |

## 6. User stories

1. As an operator, I approve a document plan once, then the AI composes the
   document across as many calls and sessions as it takes, without me
   triggering each pass.
2. As an operator, I can see how each part of the document was produced —
   written by the AI, or filled in mechanically.
3. As an operator, even when nothing required my confirmation, I can see how
   much happened — how many segments, how many model calls.
4. As an admin, I can require a stricter minimum checkpoint cadence across
   the deployment than an individual flow author configured.
5. As a flow author, I can choose how often my flow's composition
   checkpoints, appropriate to what the flow produces.

## 7. Pages / surfaces affected

- Flow editor — the document-generation node's config gains a
  checkpoint-granularity selector.
- Chat session — a plan-approval step before composition starts; segment
  rendering with inline provenance; checkpoint confirmation prompts; a
  persistent composition-summary banner.
- Admin settings — `DocumentGenerationConfig`'s UI gains the 3 orchestration
  fields; a new `minimumCheckpointGranularity` setting.
- tRPC: new router/procedures for starting a composition, approving a plan,
  resolving a checkpoint, and reading composition state.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_document_compositions` | NEW — `id`, `session_id`, `node_id`, `plan jsonb`, `checkpoint_granularity text`, `status text`, `model_call_count integer default 0`, `created_at`, `updated_at` | yes (`app_`) |
| `app_document_composition_segments` | NEW — `id`, `composition_id`, `order int`, `plan_section_key text`, `status text`, `content text`, `provenance text`, `source_ref jsonb` nullable, `confidence real` nullable, `qa_sampled boolean default false`, `qa_review_status text` nullable, `revision_count int default 0`, `created_at`, `updated_at` | yes (`app_`) |

One generated migration, additive only:

```
-- data-impact: preserved — new tables only; no existing row is read, altered, or lost
```

No prior migration for `app_session_drafts` was ever generated (the old
ADR-051 was never built), so there is nothing to retract or reconcile.

Segments are stored as **rows**, not nested inside the composition's JSONB,
specifically so a review surface can filter, count, and sample with plain
SQL (`WHERE qa_sampled = false ORDER BY random() LIMIT N`, `GROUP BY
status`) without loading full segment content — §10's acceptance criteria
reflect this directly.

Separately, `DocumentGenerationConfig` (an existing admin settings row, not
a table) gains `compositionSegmentContextScope`, `compositionRecentSegmentsWindow`,
`compositionMaxTurnsPerSegment`. No migration needed — it's a JSON row read
through a tolerant parser with safe defaults, the same mechanism
`fieldBatchSize` and `contextBudgetMode` already use
(`runtime-config.ts:102-114`).

## 9. Architectural decisions

- **New**: ADR-051 (rewritten) — `DocumentComposition` as a general-purpose
  entity, checkpoint-granularity governance, and why orchestration limits
  extend `DocumentGenerationConfig` rather than the spend-quota system.
- **Assumes**: ADR-053 (`FieldProvenance` / `FieldSourceRef` reuse), ADR-038
  (`generate_document` output type), ADR-033 (extraction flows — explicit
  non-overlap).
- **Supersedes**: the prior "Proposed" content of ADR-051 (session drafts and
  step-output finalisation) in full.

## 10. Acceptance criteria

- [ ] A plan with N sections and per-section target depth requires exactly
      one human confirmation to start, not N.
- [ ] `ComposeNextSegment` selects the next incomplete-or-under-depth segment
      without human input, honouring the resolved checkpoint granularity.
- [ ] `clampCheckpointGranularity` always resolves to the stricter of the
      admin floor and the flow-authored value; a deployment with no admin
      setting behaves exactly as before (the floor defaults to `autonomous`).
- [ ] Every segment carries a `provenance` value before it can be marked
      `final`; a segment with no provenance is rejected, not defaulted.
- [ ] The composition summary (segment count, model-call count, provenance
      mix) renders without loading segment content, and is present at every
      checkpoint-granularity setting including `autonomous`.
- [ ] A `final` segment is never rewritten by a later pass; a revision
      creates a new attempt and increments `revisionCount`.
- [ ] The migration applies to a database with existing sessions and step
      outputs, with no row loss.
- [ ] `GenerateDocument`'s existing single-shot behaviour is unchanged by the
      `DocumentGenerationConfig` extension — the new fields default to
      values that do not alter today's output.

## 11. Out of scope / future work

- `ISourceRetrievalPort` and any concrete retrieval adapter, for
  locator-resolved (`verbatim`) segments against an external source —
  nothing here blocks adding it later; `FieldProvenance` already reserves
  the value.
- The fuller statistical-sampling review surface (weighted sampling,
  aggregate dashboards across large compositions) — the mandatory summary
  banner is the phase-1 floor.
- Manual editing of a finalized segment.
- Per-flow override of the orchestration limits in `DocumentGenerationConfig`
  — stays a global admin setting unless a real need for per-flow tuning
  appears.
- A second consumer of the `DocumentComposition` shape beyond document
  generation — the shape is kept generic on purpose, but nothing here builds
  a second consumer speculatively.

## 12. Risks / open questions

- **Checkpoint-granularity clamping is new logic with no precedent in this
  codebase** — checked against the spend-quota resolution model (ADR-026,
  user/role/global, most-specific-wins) and the MCP-tool-allowlist model
  (admin permits a set, author filters within it); neither fits an ordinal
  dial. Needs solid test coverage, since a bug here could silently under- or
  over-gate a composition.
- **Segments-as-rows is a departure from this schema's usual
  one-row-per-entity pattern** — accepted because the QA-query patterns this
  is designed for need it.
- **`DocumentGenerationConfig` is already consumed by `GenerateDocument`** —
  the new fields must default to values that don't change existing
  single-shot generation behaviour; needs an explicit test asserting that.
- **Milestone interval for `per_milestone`** is not fixed in this PRD (every
  N segments? every X% of plan?) — left as a build-time parameter; doesn't
  change the architecture either way.
- **This whole PRD is contingent on @rbrasier confirming the reframed
  problem statement on PR #262** — if the reframing is rejected, this needs
  re-deriving again, per the PR's own stated process.
