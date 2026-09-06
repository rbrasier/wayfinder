# Phase — Document Composition

> **Rewritten in full.** Replaces the prior "Extended Workflow Continuity"
> phase doc (session drafts, step-output finalisation), which described a
> problem PR #262 withdrew. Nothing from the prior version carries forward
> except §10 below, preserved because its argument was never really about
> drafts.

- **Status**: Awaiting review — pending confirmation from @rbrasier on
  PR #262 that the reframed problem statement is correct
- **Target version**: 0.33.0 (bump: MINOR — two new `app_` tables, additive
  `DocumentGenerationConfig` fields, new feature)
- **PRD**: `docs/development/prd/extended-workflow-continuity.prd.md`
- **ADRs**: ADR-051 (rewritten — document composition, checkpoint
  granularity, orchestration limits)
- **Depends on**: ADR-053 (field provenance and dual confidence), ADR-038
  (`generate_document` output type), ADR-033 (extraction flows — explicit
  non-overlap, §9 below)

## 1. Problem

A single LLM call has a fixed output ceiling. A document that needs to be
larger or more detailed than one call can produce hits that two ways: more
*sections* than one call's output window holds, or a section present but
under-covered because the model ran out of room before treating it properly.
`GenerateDocument` already batches work across calls on the input side
(`generate-document.ts:173-186`) but assembles the document itself
deterministically, in one call (`generate-document.ts:93-97`). See the PRD
and ADR-051 for full detail on why this is new capability, not a fix.

## 2. Goals

- A document plan (ordered sections with a target depth) is approved once,
  before composition starts.
- The AI composes the document autonomously against that plan, across as
  many model calls and sessions as needed.
- Every segment records how it was produced (`FieldProvenance`, reused from
  ADR-053).
- Checkpoint cadence (how often a human confirms progress) is configurable,
  clamped between an admin floor and a flow-authored value.
- A composition summary (segments, model calls, provenance mix) is always
  visible, regardless of checkpoint cadence.

## 3. Non-goals

- Editing a finalized segment's content by hand.
- Chat-transcript / composer-draft continuity — a separate problem, a
  separate PRD if it's still real.
- Changes to the extraction-flow batch engine (ADR-033) — see §9.
- Locator-resolved (`verbatim`) segments against an external source — no
  such source is integrated; see §9's deferred list.
- The fuller statistical-sampling review surface — phase 2.

## 4. Approach

Three independent slices sharing one migration.

**Composition state.** `DocumentComposition` and `CompositionSegment`
(`packages/domain/src/entities/document-composition.ts`, new) track an
ordered plan and its segments. A segment's `provenance`, `sourceRef`, and
`confidence` reuse `FieldProvenance` / `FieldSourceRef` / `FieldConfidence`
from `field-provenance.ts` unchanged — no second taxonomy (ADR-051 Decision
2). In this phase, `provenance` is only ever `"processed"` or `"derived"`;
`"verbatim"` stays unreachable until a retrieval source exists (ADR-051
Decision 5, deferred).

**Checkpoint granularity.** `CompositionCheckpointGranularity` is a closed,
ordered type set by the flow author on the node, clamped against a new
admin-level floor (`minimumCheckpointGranularity`, defaulting to
`"autonomous"`) via a pure function, `clampCheckpointGranularity`, resolved
once at composition start and stored as the resolved value (ADR-051 Decision
3). This is new governance logic with no precedent elsewhere in the
codebase — the spend-quota cascade and the MCP-tool-allowlist pattern were
both checked and neither fits an ordinal dial.

**Orchestration limits.** `DocumentGenerationConfig`
(`packages/domain/src/entities/runtime-config.ts`, existing, extended) gains
`compositionSegmentContextScope`, `compositionRecentSegmentsWindow`, and
`compositionMaxTurnsPerSegment` — global admin settings governing how much
context a segment-composing call sees and how many attempts a segment gets.
Explicitly **not** a cost mechanism (ADR-051 Decision 4); spend/quota
protection continues to apply automatically and separately via the
`ILanguageModel` decorator chain.

**Migration is additive and does not depend on any information-architecture
investigation** — unlike the prior version of this phase doc, there is no
existing table shape to weigh against; `app_session_drafts` was never built,
so this is a green-field schema decision, not a migration of live data.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | -------------- | ----- |
| `packages/domain/src/entities/document-composition.ts` | new | `DocumentComposition`, `DocumentPlanSection`, `CompositionSegment`, `CompositionCheckpointGranularity`, `clampCheckpointGranularity`, `isCheckpointDue`, `isCompositionComplete` |
| `packages/domain/src/entities/runtime-config.ts` | changed | `DocumentGenerationConfig` gains 3 fields; new `minimumCheckpointGranularity` setting + parser |
| `packages/domain/src/entities/index.ts` | changed | Re-exports |
| `packages/domain/src/ports/document-composition-repository.ts` | new | `IDocumentCompositionRepository` — Result pattern |
| `packages/domain/src/ports/index.ts` | changed | Re-export |
| `packages/application/src/use-cases/document/start-document-composition.ts` | new | Creates from an approved plan; resolves and stores clamped granularity |
| `packages/application/src/use-cases/document/compose-next-segment.ts` | new | Core loop step |
| `packages/application/src/use-cases/document/evaluate-composition-completeness.ts` | new | Wraps `isCompositionComplete` |
| `packages/application/src/use-cases/document/index.ts` | changed | Re-exports |
| `packages/adapters/src/db/schema/wayfinder.ts` | changed | `app_document_compositions`, `app_document_composition_segments` |
| `packages/adapters/drizzle/` | new | One generated migration |
| `packages/adapters/src/repositories/document-composition-repository.ts` | new | Drizzle implementation |
| `apps/web/src/server/routers/document-composition.ts` | new | Start composition, approve plan, resolve checkpoint, read state |
| `apps/web/src/components/chat/composition-plan-approval.tsx` | new | Plan-approval card in the message feed |
| `apps/web/src/components/chat/composition-segment-view.tsx` | new | Segment rendering, reusing `ProvenanceTag` / `FieldRationale` (`apps/web/src/components/extraction/field-provenance-detail.tsx`) |
| `apps/web/src/components/chat/composition-checkpoint-prompt.tsx` | new | Blocking confirmation, shown when due |
| `apps/web/src/components/chat/composition-summary-banner.tsx` | new | The mandatory, always-visible summary |
| `apps/web/src/components/flows/document-generation-node-config.tsx` | changed (or nearest existing node-config surface) | Checkpoint-granularity selector |
| `apps/web/src/app/(admin)/admin/settings/` | changed | `DocumentGenerationConfig` UI gains 3 fields; new `minimumCheckpointGranularity` control |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — composition entities and pure functions.** Write
   `document-composition.test.ts` first:
   (a) `clampCheckpointGranularity` returns the stricter of two values in
   every ordering, including equal values;
   (b) `isCheckpointDue` fires correctly for each granularity given a
   segment count since the last checkpoint;
   (c) `isCompositionComplete` is true only when every planned section is at
   or past its target depth.
   Then implement. Pure types and functions, zero dependencies.

2. **Domain — `DocumentGenerationConfig` extension.** Write/extend
   `runtime-config.test.ts`: the 3 new fields parse with safe defaults from
   an absent or partial settings row, and `resolveDocumentGenerationBudget`-
   equivalent resolution for the new fields does not alter any existing
   assertion for `fieldBatchSize` / `contextBudgetMode`. Then implement,
   confirming no existing test changes meaning.

3. **Application — start and compose.** Write
   `start-document-composition.test.ts` and `compose-next-segment.test.ts`
   first, against an in-memory fake repository:
   (a) starting a composition resolves and stores the clamped granularity,
   not the raw authored value;
   (b) an admin floor of `"per_segment"` overrides a flow-authored
   `"autonomous"`, and the reverse never happens;
   (c) `ComposeNextSegment` selects the next `"pending"` or under-depth
   segment, never a `"final"` one;
   (d) a segment is written only with a `provenance` set — an attempt to
   persist one without it is rejected;
   (e) `modelCallCount` increments exactly once per model call, not per
   segment-write attempt;
   (f) a `"final"` segment is never overwritten by a later call — a revision
   creates a new attempt and increments `revisionCount`.
   Then implement.

4. **Application — completeness.** `evaluate-composition-completeness.test.ts`:
   wraps `isCompositionComplete`; a composition with all sections at target
   depth is complete, one with any section under depth is not.

5. **Adapters — schema, migration, repository.** Add
   `app_document_compositions` and `app_document_composition_segments`;
   generate the migration (never `drizzle-kit push`), carrying
   `-- data-impact: preserved — new tables only; no existing row is read,
   altered, or lost`. Repository integration tests assert segment rows are
   independently queryable (`GROUP BY status`, a sampling query) without
   loading composition-level JSONB.

6. **Web — plan approval and composition rendering.** Component test first:
   the plan-approval card renders a plan and blocks on confirmation; segment
   rendering shows the correct `ProvenanceTag` per `provenance` value,
   reusing the existing component rather than a new one. Then wire the tRPC
   procedures.

7. **Web — checkpoint prompt and summary banner.** Component tests first:
   the checkpoint prompt renders only when `isCheckpointDue`, and blocks
   composition until resolved; the summary banner renders at every
   granularity setting including `"autonomous"`, and cannot be hidden by any
   prop or setting. Then wire rendering.

8. **Web — flow editor and admin settings.** Component tests first for the
   node-config checkpoint-granularity selector and the admin settings
   controls for the 3 new `DocumentGenerationConfig` fields and the new
   `minimumCheckpointGranularity` setting. Then wire.

9. **Validate.** Run `./validate.sh` after each sub-component; do not
   proceed on a non-zero exit.

## 7. Acceptance criteria

Mirrors the PRD §10 checklist, restated as the build's test plan:

- [ ] A plan requires exactly one human confirmation to start, regardless of
      section count.
- [ ] `ComposeNextSegment` runs without human input except where the
      resolved granularity requires a checkpoint.
- [ ] `clampCheckpointGranularity` always yields the stricter value; a
      deployment with no admin setting behaves exactly as before (default
      floor `"autonomous"`).
- [ ] A segment with no `provenance` is rejected at write time, never
      defaulted.
- [ ] The summary banner renders at every checkpoint-granularity setting,
      without loading segment content.
- [ ] A `"final"` segment is never rewritten; a revision writes a new
      attempt and increments `revisionCount`.
- [ ] The migration applies to a populated database with no row loss.
- [ ] `GenerateDocument`'s existing single-shot output is byte-identical
      before and after the `DocumentGenerationConfig` extension, given the
      new fields' defaults.

## 8. Playwright e2e

**Qualifies — group 4 (navigation state across a page load), for the
resume case only.** Composition state surviving a reload/resume is the
browser-visible half of state that cannot be asserted in-process; the
composition/checkpoint/provenance logic itself belongs below the browser.

- New spec `apps/web/e2e/document-composition-continuity.spec.ts`.
- Happy path: approve a plan, let composition run to a checkpoint, confirm
  it, reload, assert the composition resumes from the stored state rather
  than restarting.
- Checkpoint path: with granularity `"per_segment"`, assert the UI blocks on
  the first segment and does not proceed until confirmed.
- Autonomous path: with granularity `"autonomous"`, assert the summary
  banner is present and accurate after composition completes with no
  confirmation prompts shown.
- Obeys the non-negotiables: no `test.skip()` on a self-probed condition, no
  `isVisible()` for control flow.

**Everything else stays below the browser**: `clampCheckpointGranularity`
and the other pure functions are `packages/domain` (step 1), the
compose/checkpoint transitions are `packages/application` (steps 3–4), the
segment-row query behaviour is a `packages/adapters` integration test (step
5), and card/banner rendering is `apps/web` component tests (steps 6–8).

## 9. Explicitly deferred / out of scope

- `ISourceRetrievalPort` and any concrete retrieval adapter — no source is
  integrated yet; `"verbatim"` provenance stays unreachable until one is.
- The fuller statistical-sampling review surface (weighted sampling,
  aggregate dashboards) — phase 2.
- Manual editing of a finalized segment.
- Per-flow override of the orchestration limits in `DocumentGenerationConfig`.
- Handing a composition off to the extraction-flow batch engine (ADR-033)
  for very large documents — composition stays session-scoped regardless of
  scale. The batch engine is *N documents, 1 schema, 1 row each*; this is
  *1 document, N sections* — different shape, not merged.
- A second consumer of the `DocumentComposition` shape beyond document
  generation.

## 10. Risks / open questions

- **Checkpoint-granularity clamping and the orchestration-limit extension
  are both new mechanisms with no existing precedent** — see ADR-051
  Decisions 3–4 for what was checked and rejected. Both need dedicated test
  coverage rather than inherited coverage from an existing pattern.
- **Segments-as-rows** is a departure from this schema's usual
  one-row-per-entity shape, accepted for the QA-query patterns it enables.
- **`DocumentGenerationConfig` regression risk** — the extension must not
  alter `GenerateDocument`'s existing behaviour; step 2's test explicitly
  covers this.
- **Milestone interval for `"per_milestone"`** is not fixed by this phase
  doc (every N segments vs. every X% of plan) — a build-time parameter
  decided during implementation, not an architectural question.
- **Contingent on confirmation** — this entire phase doc assumes @rbrasier
  confirms the reframed problem statement on PR #262. If not, it needs
  re-deriving again.

---

## 10.5 Information-architecture note carried from the prior phase doc

The prior version's §10 finding (2026-08-25) established, against the old
`app_session_drafts` proposal, that a debounced per-participant write cannot
live on `app_sessions` because of its optimistic-concurrency `version`
column, and that draft-versus-final status could not be derived from
`awaiting_confirmation_node_id` because that pointer is nulled on confirm.
Neither finding applies directly to `DocumentComposition` — this phase
doesn't touch `app_sessions` or step-output finalisation at all — but the
underlying caution (don't let a hot-write concept share a row with a
version-guarded or lease-guarded one) is why `app_document_compositions` and
its segments are their own tables rather than columns grafted onto anything
existing.
