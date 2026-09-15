# Phase — Auto Analyse for Synthesise Information

- **Status**: Awaiting review
- **Target version**: 0.37.0  (bump: MINOR — new feature; **one migration**, see §8)
- **PRD**: `docs/development/prd/auto-analyse-synthesis.prd.md`
- **ADRs**: ADR-059 (Auto Analyse writes into the draft field set), ADR-060 (analysis is an
  extraction run mode)
- **Depends on**: ADR-013 (annotation lingua franca), `033-extraction-flows.adr.md` §3/§7/§9
  (authoring config, permission split, cost ceiling — cited by filename; a second ADR-033 exists)
- **Supersedes**: `collaborative-schema-definition.phase.md` (retired with ADR-052)
- **Source**: issue #296

## 1. Problem

The Synthesise Information editor asks the author to specify the entire field set — labels, types,
instructions — plus two questions about document reading and record cardinality, all before the AI
has read anything. The documents already imply most of those answers. See the PRD.

## 2. Goals

- Uploading input documents drafts a field set automatically, with no button press.
- The read-guidance and file-mapping controls leave the default path.
- Every drafted field is editable afterwards through the existing field editor.
- Hand-edited fields survive later analyses untouched.
- How many documents the analysis reads is visible and adjustable, subtly.

## 3. Non-goals

- The general background/iterative drafting capability from issue #296's original text.
- Multi-turn conversational refinement — superseded, see ADR-059.
- Proposing the output template, output instruction or context docs.
- A new table. The analysis reuses the run aggregate (ADR-060).

## 4. Approach

An analysis is an `app_extraction_runs` row with `mode: "analyse"` and a null `flow_version_id`
(ADR-060). It reads up to `analyseSampleSize` of the flow's existing
`app_extraction_draft_documents` in place, extracts their text through the existing
`IDocumentExtractor`, and asks a new `IFieldProposer` for `ExtractionFieldDraft[]` — the pre-parse
author type that already exists. The drafts go through `buildExtractionField` and into the open
draft snapshot by the same path a hand-typed field takes (ADR-059).

The proposer emits annotation lines (`Supplier Name (text)`, `Submission Date (date) (optional)`),
so `parseTemplateField` stays the single route into the field model. This mirrors `selectRecordFiles`,
which is the existing precedent for a structured-output pass returning authoring decisions.

Two settings join `ExtractionInputConfig` inside the flow snapshot — no authoring table change.

## 5. Key entities / files

| Path | New / changed | Notes |
| ---- | ------------- | ----- |
| `packages/domain/src/entities/extraction-schema.ts` | changed | `autoAnalyse`, `analyseSampleSize` on `ExtractionInputConfig`; new `MAX_ANALYSE_DOCUMENTS = 10`; validation in `validateInputConfig` |
| `packages/domain/src/entities/extraction-run.ts` | changed | `RunMode` gains `"analyse"`; `flowVersionId` becomes `string \| null`; `isAnalysisRun` helper |
| `packages/domain/src/ports/field-proposer.ts` | new | `IFieldProposer`, mirroring `ISeedProposer` |
| `packages/domain/src/entities/index.ts`, `ports/index.ts` | changed | Re-exports |
| `packages/shared/src/schemas/extraction.ts` | changed | `fieldProposalSchema` |
| `packages/application/src/use-cases/extraction/propose-extraction-fields.ts` | new | Read docs → propose → merge into draft |
| `packages/application/src/use-cases/extraction/merge-proposed-fields.ts` | new | Append-and-fill merge; never overwrites |
| `packages/application/src/use-cases/extraction/start-batch-run.ts` | changed | `startAnalysis()`; version required only for sample/full |
| `packages/application/src/use-cases/extraction/advance-batch-runs.ts` | changed | Analyse branch: claim the run as one unit; never the document-claim path (ADR-060 §4) |
| `packages/adapters/src/ai/field-proposer.ts` | new | `IFieldProposer` over the language model |
| `packages/adapters/src/db/schema/wayfinder.ts` | changed | `flow_version_id` nullable; `mode` enum widened |
| `packages/adapters/drizzle/00NN_*.sql` | new | One generated migration (§8) |
| `apps/web/src/server/routers/extraction.ts` | changed | `startAnalysis` (**`authorProcedure`**), `analysisStatus` (`viewProcedure`); `saveSchema` input; `listRuns` excludes analyses |
| `apps/web/src/components/extraction/editor-cards.tsx` | changed | Toggle, sample-size control, conditional hiding, card widths, Run button placement |
| `apps/web/src/components/extraction/editor-cards-controls.tsx` | changed | Subtle inline numeric control (§7) |
| `apps/web/src/lib/container-extraction.ts`, `apps/api/src/container.ts` | changed | Wire the proposer and the new use cases |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — input config settings.** Extend `extraction-schema.test.ts` first: (a) a config with
   `autoAnalyse` true normalises `cardinality` to `one_per_file` and `selectionCriteria` to null;
   (b) `analyseSampleSize` below 1 or above `MAX_ANALYSE_DOCUMENTS` (10) is a `VALIDATION_FAILED`;
   (c) an absent `analyseSampleSize` defaults to 3, **not** to the ceiling; (d) `autoAnalyse` false
   leaves the existing selection-criteria rules exactly as they are today. Then implement in
   `validateInputConfig`. Pure, no dependencies.

2. **Domain — run mode.** Extend `extraction-run.test.ts` first: (a) an analyse run is claimable
   while `running`, like any other; (b) `isAnalysisRun` is true only for `mode: "analyse"`;
   (c) `hasReachedPreviewBoundary` is false for an analyse run (boundary 0); (d) `settledRunStatus`
   returns `partial` when a document was unreadable and `complete` otherwise. Then widen `RunMode`
   and make `flowVersionId` nullable.

3. **Domain — proposer port.** Add `IFieldProposer`: `propose(request: FieldProposalRequest):
   Promise<Result<ExtractionFieldDraft[]>>`, where the request carries the document texts and their
   filenames. Type-only, mirroring `ISeedProposer`. No repository port — ADR-059 stores no proposal.

4. **Shared — proposal schema.** Add `fieldProposalSchema`: an array of `{ label, annotation,
   instruction }` with `.describe()` text naming the valid annotations, sourced from
   `VALID_ANNOTATIONS_HINT` rather than retyped. Test that a well-formed proposal parses and a
   proposal with an empty `label` or `instruction` does not.

5. **Application — merge.** Write `merge-proposed-fields.test.ts` first: (a) proposed fields append
   to an empty set in order; (b) a proposed field whose derived key collides with an existing field
   is dropped, and the existing field is untouched; (c) an existing field is never modified, even
   when the proposal offers a better instruction for it; (d) a proposal that is entirely duplicates
   produces no change and is not an error; (e) the merge is pure — it returns a new field set and
   mutates nothing. Then implement.

6. **Application — propose.** Write `propose-extraction-fields.test.ts` first against an in-memory
   fake proposer and fake extractor: (a) at most `analyseSampleSize` documents are read even when
   more are staged; (b) fewer documents than the sample size is fine and reads all of them;
   (c) a document the extractor cannot read increments `unreadableCount` and the pass continues on
   the rest; (d) every document unreadable settles the run `partial` and writes no fields; (e) a
   proposer error settles the run `partial` and leaves the draft field set byte-identical
   (ADR-059 §4); (f) an unparseable annotation is dropped with the rest of the proposal kept;
   (g) a successful pass writes through `buildExtractionField` and settles `complete`. Then
   implement.

7. **Application — start and advance.** Tests first: (a) `startAnalysis` creates a run with
   `mode: "analyse"`, null `flowVersionId` and `previewBoundary` 0, for a flow with **no** draft
   version; (b) `startAnalysis` refuses when an analysis run for the flow is already `running`;
   (c) `startSample` and `startBatch` still require a version and still error without one;
   (d) `AdvanceBatchRuns` claims an analyse run as a **single unit of work** and runs the read and
   the proposal inside that one claim (ADR-060 §4); (e) it never sends an analyse run down the
   document-claim path — assert no document rows are claimed and the run is not settled complete
   with zero work; (f) the cost ceiling is checked **before** the analyse claim, and a run already
   at or over it is not claimed; (g) a claim abandoned mid-flight (simulating a worker restart)
   leaves the run `running` and claimable, and the next tick completes it. Then implement.

8. **Adapters — proposer.** Implement `IFieldProposer` over the language model with
   `fieldProposalSchema`, **verifying the SDK call shape in `node_modules`** rather than from
   memory. Follow `selectRecordFiles`' prompt structure. Respect the existing generation budget.

9. **Adapters — schema and migration.** Widen the `mode` enum (TypeScript only) and make
   `flow_version_id` nullable. Generate the migration with `drizzle-kit generate` — never
   `drizzle-kit push` — and add the `-- data-impact:` declaration from §8. Audit every existing
   reader of `flowVersionId` for null handling and list them in the PR body (ADR-060).

10. **Web — router.** Add `startAnalysis` on **`authorProcedure`** and `analysisStatus` on
    `viewProcedure`, both behind the existing `canEditFlow` check. `startAnalysis` must not sit on
    `runProcedure`: analysis writes the field set, so a caller holding only `extraction:run` would
    otherwise rewrite a flow's schema by uploading a file — an authoring act through a run-level
    door (`033-extraction-flows.adr.md` §7). Extend `saveSchema`'s zod input with the two settings.
    Exclude `"analyse"` from `listRuns`. Test both permission boundaries and the sample-size bound
    server-side — the UI control is not the enforcement point.

11. **Web — editor.** Component tests first, then the UI (§7). Cover: toggle default on; the two
    controls absent from the DOM while on; previous manual values restored when toggled off;
    analysis states rendered; the sample-size control bounded; `Run sample` present in the Input
    card header while on; and the whole Auto analyse control absent from the DOM for a user without
    `extraction:author`.

12. **Validate.** Run `./validate.sh` and fix every failure before declaring done.

## 7. UI specification

**Auto analyse toggle.** A `Switch` in the Input card header (`FocusCard` `headerAction`), labelled
"Auto analyse", on by default — and rendered only for a user holding `extraction:author`. A
run-only user sees the Input card exactly as it is today: no toggle, no sample-size control, no
analysis states. Not disabled, not tooltipped — absent. While on:

- The `read-instructions` Textarea and the `How do files map to records?` `Segmented` are **not
  rendered** — hidden, not disabled, so they are absent from the DOM and from the accessibility
  tree. The `Which files make up one record?` Textarea goes with them.
- `cardinality` is `one_per_file` and `selectionCriteria` is null in the saved config.
- The `Run sample` button renders in the Input card header rather than the Output card header. The
  system-prompt eye icon stays in the Output card.

Toggling off restores the author's last saved `guidance`, `cardinality` and `selectionCriteria`
rather than blanks — the component holds them in state across the toggle, the way `manualFields` and
`templateFields` are already kept apart so neither loses the other's work.

**Sample-size control — subtle by design.** Next to the toggle, rendered only while Auto analyse is
on: a small inline stepper reading "reads 3 docs", muted (`text-[11px] text-[#736d5f]`), with the
number the only interactive part. Bounded 1..`MAX_ANALYSE_DOCUMENTS` (10). It must not read as a primary
control — it sits at label weight beside the switch, not as a labelled form field, and it carries a
`title` explaining that more documents means a wider field set at higher cost.

`MAX_ANALYSE_DOCUMENTS` (10) is deliberately its own constant, not a raised `SAMPLE_MAX_DOCUMENTS`.
The latter sizes a sample *run* — how many records an author previews before committing to a full
batch — and has no business moving because the analysis read ceiling moved. Step 1(b) asserts both
values independently so a future change to one cannot silently drag the other.

**Card proportions.** The current even `lg:flex-row` split becomes roughly 60/40 in the Input card's
favour, since the Output card is now AI-drafted. Both cards keep stacking vertically below `lg`.

**Analysis states**, in the Input card below the upload tree:

| State | Copy |
| ----- | ---- |
| Running | "Analysing 3 documents…" (count from the run's `totalCount`) |
| Complete | "Drafted 7 fields from your documents." |
| Partial, some fields | "Drafted 5 fields. 1 document could not be read." |
| Partial, no fields | "Could not draft fields from these documents." + Retry |
| Failed | "Analysis failed." + Retry |
| No uploads | Nothing — the analysis UI is absent until there is something to analyse |

**Trigger.** The client starts the analysis after `uploadDraftDocuments` succeeds, then polls
`analysisStatus` and invalidates `getSchema` when it settles. The server does not start an analysis
implicitly on upload — an explicit call keeps the upload endpoint's contract unchanged and makes the
"one live analysis per flow" rule enforceable in one place.

Where no batch worker runs (`apps/web` alone — see PRD §7), the client must also drive
`extraction.tick` while polling, the way a sample run is driven today. Reopening the editor on an
unsettled analysis resumes it; it never restarts it, and never starts a second one.

## 8. Database & migration

One generated migration, `app_` prefix, on an existing table:

```sql
-- data-impact: preserved — DROP NOT NULL widens the column; every existing row keeps its flow_version_id
ALTER TABLE "app_extraction_runs" ALTER COLUMN "flow_version_id" DROP NOT NULL;
```

`mode` is plain `text` with no check constraint (verified in `0038_careful_quentin_quire.sql`), so
adding `"analyse"` is a TypeScript change with no SQL. No new tables; the two input-config settings
live in the existing `FlowSnapshot` jsonb.

`migration-safety.test.ts` will want the declaration above. `DROP NOT NULL` is not in the blocking
list, and the declaration records why: it widens rather than narrows, so no existing row can fail it.

## 9. Retirement of the superseded docs

Already carried out in the commit that introduced this phase doc — recorded here so the reversal is
visible to whoever implements it, not as work for `/build`:

- `docs/development/to-be-implemented/collaborative-schema-definition.phase.md` — deleted.
- `docs/development/prd/collaborative-schema-definition.prd.md` — deleted.
- ADR-052 — marked `Superseded by ADR-059`. The file stays, as the record of a decision made and
  reversed.

One thing `/build` must not undo: ADR-052 is still cited by ADR-057, `flow-memory.prd.md` and
`calculated-extraction-fields.phase.md` for its propose/validate discipline, which this phase does
not touch. Those citations stay as they are.

## 10. Acceptance

The PRD's §10 checklist is the test plan. A step is done when its tests are written first, pass, and
`./validate.sh` is clean.

## 11. Risks

- **`flowVersionId` nullability** touches every reader of the run aggregate. Step 9's audit is the
  mitigation and its output belongs in the PR body.
- **The never-overwrite rule** carries the safety burden that a confirm step would otherwise carry
  (ADR-059 §3). Step 5's tests are the enforcement.
- **Automatic spend.** Analysis fires on upload, so the cost ceiling is the only guard, and a
  run-level claim means it is checked once before the claim rather than between documents
  (ADR-060 §4) — a run can finish up to one analysis over the ceiling. Step 7(f) tests the check
  explicitly rather than assuming inheritance from the run aggregate.
- **Durability varies by deployment.** Only `apps/api` with `EXTRACTION_WORKER_ENABLED` advances an
  analysis without a tab open. Step 7(g) tests worker-restart resumption; §7's trigger rule covers
  the web-only path. The UI copy must not promise background completion the deployment cannot give.
- **Proposal quality varies with document type.** A scanned PDF with no extractable text yields
  nothing useful; the partial-with-no-fields state exists so that failure is legible rather than
  silent.

---

## 12. Approved build summary (`/build`, 2026-09-15)

Auto Analyse makes the Synthesise Information editor draft its own extraction fields. Uploading
input documents starts a background analysis run that reads up to ten of them, proposes a field set
with labels, types and instructions, and writes it straight into the open draft for the author to
edit by hand. A toggle in the Input card header turns it on by default and hides the two questions
non-technical authors cannot answer. Nothing a user has typed is ever overwritten, and Publish
remains the gate that makes any of it real.

**Business rules changing** — analysis starts on successful upload with no user action; while on,
`cardinality` is forced to `one_per_file` and `selectionCriteria` to null, with the author's saved
values restored on toggle-off; a proposed field whose derived key collides with an existing one is
dropped; a failed analysis leaves the field set byte-identical and offers a retry; one live analysis
per flow.

**Version, branch, PR** — MINOR to 0.37.0 from `main`'s 0.36.0. Built on
`claude/practical-franklin-iahe4j`, this session's designated branch, which overrides the skill's
`feature/<slug>/claude-<username>` convention. PR against `main`.

**Source issue** — #296 "Agent background processing". It asked for background orchestration so a
long document-drafting job need not rest on one huge context window. This phase answers the Auto
Analyse half specified in the issue comments; the blackboard-style iterative drafting stays open.

**e2e decision** — no spec. Under `docs/guides/e2e-test-policy.md` none of the six groups is met:
the file-upload boundary is already covered by existing specs and this adds no new file-dialog or
download path. Coverage sits at `apps/web` component tests (toggle, analysis states, permission
absence) and `packages/application` (merge, propose, claim).

**Build order** — 12 sub-components of no more than four files each: (1) domain input config,
(2) domain run mode, (3) proposer port, (4) shared schema, (5) merge use case, (6) propose use case,
(7) start and advance, (8) adapter proposer, (9) DB schema, migration and the null audit,
(10) router, (11) editor UI, (12) final validation.
