# PRD — Auto Analyse for Synthesise Information

- **Status**: Draft
- **Date**: 2026-09-15
- **Author**: rbrasier (from issue #296, reported by johntooth)
- **Target version**: 0.37.0  (bump: MINOR — new feature plus a schema change)

## 1. Problem

Defining what to extract is the hardest part of setting up a synthesis, and it is entirely
manual. Before a user sees a single result they must name every field, pick its type, write an
instruction for each, and answer two questions about how the AI should read their documents and
how files map to records — all before the AI has looked at anything. The documents they just
uploaded already imply most of those answers, and the user is the one least equipped to guess
them.

The cost is felt twice: people abandon the editor at step 2, and those who push through
under-specify the field set, so the first run produces a spreadsheet that misses the columns they
actually wanted. Issue #296 names the underlying worry as well — the more a person has to cram
into one specification up front, the more the whole thing rests on a single large pass that can
drift.

## 2. Users / Personas

- **Flow author (procurement officer, HR manager, ops lead)** — has a folder of tender responses,
  CVs or invoices and knows what the finished spreadsheet should tell them, but does not think in
  terms of field types, annotations or record cardinality. Needs the tool to propose the structure
  so they can correct it rather than invent it.
- **Returning author** — already has a working synthesis and is adding a new document set. Needs
  Auto Analyse to stay out of the way and never overwrite the field set they tuned by hand.

## 3. Goals

- A user who uploads input documents and does nothing else sees a drafted field set — labels,
  types and extraction instructions — appear in the Output card without pressing anything.
- The two questions a non-technical author cannot answer ("How should the AI read these
  documents?", "How do files map to records?") are absent from the default path.
- Every AI-drafted field is editable, renameable, retypeable and deletable by hand afterwards,
  through the existing field editor and with no separate mode.
- A field the user has edited by hand is never overwritten by a later analysis.
- The user can see how many documents the analysis reads, and change it, without that control
  competing for attention with the upload area.
- Analysis failure is visible and recoverable, and never leaves a half-written field set behind.

## 4. Non-goals

- The general background/iterative drafting capability described in the first half of issue #296
  ("blackboard system", long-range multi-step document drafting). That remains open on the issue.
- Multi-turn conversational refinement of the field set. This PRD supersedes
  `collaborative-schema-definition.prd.md`, which planned exactly that (see §9).
- Proposing the output template, the output instruction, or context documents — fields and
  cardinality only.
- Re-analysing automatically when documents are added to an existing, already-drafted synthesis.
- Replacing the manual editor. Auto Analyse is a toggle over it, not a separate authoring surface.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ExtractionInputConfig` | `packages/domain/src/entities/extraction-schema.ts` | existing, changed | Gains `autoAnalyse: boolean` and `analyseSampleSize: number` (default 3, bounded by `MAX_ANALYSE_DOCUMENTS`) |
| `MAX_ANALYSE_DOCUMENTS` | `packages/domain/src/entities/extraction-schema.ts` | new | `10` — the analysis read ceiling. Distinct from `SAMPLE_MAX_DOCUMENTS` (3), which sizes a sample *run* and is unchanged |
| `RunMode` | `packages/domain/src/entities/extraction-run.ts` | existing, changed | Gains `"analyse"` |
| `ExtractionRun` | `packages/domain/src/entities/extraction-run.ts` | existing, changed | `flowVersionId` becomes `string \| null` |
| `IFieldProposer` | `packages/domain/src/ports/field-proposer.ts` | new | `propose()` → `Result<ExtractionFieldDraft[]>`, modelled on `ISeedProposer` |
| `ExtractionFieldDraft` | `packages/domain/src/entities/extraction-schema.ts` | existing, unchanged | The proposer's output type — the pre-parse author type that already exists |
| `fieldProposalSchema` | `packages/shared/src/schemas/extraction.ts` | new | Structured-output schema emitting annotation lines |
| `ProposeExtractionFields` | `packages/application/src/use-cases/extraction/propose-extraction-fields.ts` | new | Reads documents, calls the proposer, merges into the draft |

## 6. User stories

1. As a flow author, I can upload three tender responses and find the Output card already
   populated with sensible fields, so that I am correcting a draft instead of facing a blank form.
2. As a flow author, I can see that the AI is analysing my documents and how far it has got, so
   that I know the editor has not simply frozen.
3. As a flow author, I can turn Auto Analyse off, so that the manual read-guidance and
   file-mapping controls come back exactly as I left them.
4. As a flow author, I can change how many of my documents the analysis reads, so that a set of
   dissimilar documents can inform a wider field set.
5. As a flow author, I can rename, retype and delete any AI-drafted field, so that the final
   schema is mine.
6. As a returning author, I can upload more documents without my hand-tuned fields being
   overwritten.
7. As a flow author, I can run a sample straight from the Input card once the fields are drafted,
   so that I do not have to cross the editor to start.

## 7. Pages / surfaces affected

- `/synthesise/[id]/edit` — Input card gains an "Auto analyse" toggle and a subtle sample-size
  control in its header; the read-guidance Textarea and file-mapping Segmented hide while the
  toggle is on; the Input card widens relative to the Output card; the `Run sample` button moves
  into the Input card header while the toggle is on.
- tRPC: `extraction.startAnalysis` — added, on **`authorProcedure`**. Starts an analysis run for a
  flow. Analysis writes the schema, which is an authoring act, so it sits behind
  `extraction:author` and not `extraction:run` (see §9).
- tRPC: `extraction.analysisStatus` — added, on `viewProcedure`. Polls a running analysis and
  returns drafted fields when it settles. Reading progress is not an authoring act.
- tRPC: `extraction.saveSchema` — changed. Accepts `autoAnalyse` and `analyseSampleSize` in the
  input config.
- tRPC: `extraction.listRuns` — changed. Excludes `mode: "analyse"`; a user opening run history
  means extraction runs, not schema analyses.
- tRPC: `extraction.uploadDraftDocuments` — unchanged on the wire; the client starts an analysis
  after a successful upload rather than the server doing it implicitly.

**A user holding only `extraction:run` does not see the Auto analyse toggle at all.** They upload
and run against a schema someone else authored, exactly as `033-extraction-flows.adr.md` §7 intends.
The toggle is not rendered disabled — advertising a control they cannot use is worse than its
absence.

### Durability depends on the deployment

The promise that a user can leave and come back holds where the batch worker runs — `apps/api` with
`EXTRACTION_WORKER_ENABLED=true`. `apps/web` has no worker and advances runs through the
client-polled `extraction.tick` procedure, so in a web-only deployment an analysis progresses only
while the editor is open and stalls if the tab closes, resuming when it is reopened. This is exactly
how a sample run already behaves; Auto Analyse inherits it rather than introducing it. The UI copy
must not promise more than the deployment can deliver.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `app_extraction_runs` | `ALTER COLUMN flow_version_id DROP NOT NULL` | n/a (existing `app_`) |
| `app_extraction_runs` | `mode` gains `"analyse"` — **no SQL**, the column is plain `text` with no check constraint | n/a |

No new tables. The analysis run reuses the existing run aggregate (ADR-060), and the two new
input-config settings live inside the existing `FlowSnapshot` jsonb, so there is no authoring
table change either.

The migration must carry the declaration:

```sql
-- data-impact: preserved — DROP NOT NULL widens the column; every existing row keeps its flow_version_id
```

## 9. Architectural decisions

- **ADR-059 — Auto Analyse writes into the draft field set** (new). Reverses ADR-052 for this
  path: a proposal is written directly into the draft rather than held as unconfirmed state.
- **ADR-060 — Analysis is an extraction run mode** (new). The analysis reuses
  `app_extraction_runs` rather than introducing a table, and relaxes the `flow_version_id`
  invariant to do so.
- **ADR-052 — A schema proposal is a draft artefact requiring explicit activation** — becomes
  **Superseded by ADR-059**. Its companion PRD (`collaborative-schema-definition.prd.md`) and
  phase doc are retired with it.
- **ADR-013** (template-field annotations as the lingua franca) — assumed. The proposer emits
  annotation lines and they go through `parseTemplateField`, so there is no second route into the
  field model.
- **`033-extraction-flows.adr.md`** — assumed and extended. §3 (authoring config inside the flow
  snapshot) houses the two new input-config settings; §7 (`extraction:author` vs `extraction:run`)
  decides which permission gates analysis; §9 (per-run cost ceiling) is what bounds its spend.
  Cited by filename throughout: a second, unrelated ADR-033 exists
  (`033-immutable-audit-log-and-legal-hold.adr.md`), and the bare number is ambiguous.

## 10. Acceptance criteria

- [ ] A new synthesis has `autoAnalyse` on and `analyseSampleSize` at 3 by default.
- [ ] `MAX_ANALYSE_DOCUMENTS` is 10 and `SAMPLE_MAX_DOCUMENTS` is still 3 — raising one never moves the other.
- [ ] Uploading at least one input document while Auto Analyse is on starts an analysis run
      without any further user action.
- [ ] The analysis reads at most `analyseSampleSize` documents, and at most the number uploaded.
- [ ] A settled analysis writes `ExtractionFieldDraft`s into the draft field set, each with a
      label, a parseable annotation carrying a type, and a non-empty instruction.
- [ ] A field the user has edited by hand is preserved verbatim across a later analysis.
- [ ] A failed analysis leaves the existing field set byte-identical and surfaces a retry control.
- [ ] While Auto Analyse is on, `input.cardinality` persists as `one_per_file` and
      `input.selectionCriteria` persists as `null`.
- [ ] Turning Auto Analyse off restores the user's previously saved guidance and cardinality
      rather than blank values.
- [ ] The read-guidance and file-mapping controls are absent from the DOM while the toggle is on.
- [ ] The sample-size control accepts 1..`MAX_ANALYSE_DOCUMENTS` (10) and rejects anything outside
      it, server-side as well as in the UI.
- [ ] Only one analysis run per flow is live at a time; a second upload during analysis does not
      start a competing run.
- [ ] `AdvanceBatchRuns` claims an analyse run as a single unit of work and never sends it down the
      document-claim path.
- [ ] The per-run cost ceiling is checked before an analyse run is claimed, and a run already at or
      over the ceiling is not claimed.
- [ ] A worker restart mid-analysis leaves the run claimable, and a later tick completes it.
- [ ] `startAnalysis` rejects a caller holding `extraction:run` but not `extraction:author`.
- [ ] The Auto analyse toggle is absent from the DOM for a user without `extraction:author`.
- [ ] `listRuns` returns no `mode: "analyse"` rows.
- [ ] Where a batch worker runs, an analysis started and then abandoned by the client still settles
      and its fields are present on return.
- [ ] Where no batch worker runs, an analysis advances on `tick` while the editor is open, and a
      reopened editor resumes rather than restarting it.
- [ ] `Run sample` is reachable from the Input card header while Auto Analyse is on.
- [ ] An analysis run can start for a flow that has no draft version yet.

## 11. Out of scope / future work

- Long-range iterative drafting and blackboard-style orchestration (issue #296's original text).
- "Define the headers, AI populates the columns" — already shipped as the Template output mode.
- Re-analysis prompts when a document set changes substantially after the first draft.
- Proposing `doneWhen` completion criteria alongside each field.
- Conversational refinement of a drafted field set, should it be wanted again later.

## 12. Risks / open questions

- **Reversing a standing decision.** ADR-052 held that an unconfirmed field set is never written
  durably. ADR-059 reverses that here on the grounds that the draft is pre-publish. It is a real
  reversal, not a clarification.
- **Discarding planned work.** Superseding `collaborative-schema-definition` drops its revision
  history, validation-before-confirm and multi-turn refinement design.
- **Automatic spend, loosely bounded.** Analysis fires on upload rather than on a button, so the
  cost ceiling is the only thing standing between a user and repeated unprompted spend — and
  because the claim is run-level, that ceiling is checked once before the claim rather than between
  documents (ADR-060 §4). A run that starts under the ceiling can finish over it by up to one
  analysis.
- **Distinguishing hand-edited from AI-drafted fields** is what the never-overwrite rule rests on.
  If that distinction is unreliable, the rule is unenforceable.
- **A weakened invariant.** `flow_version_id` going nullable affects every reader of the run
  aggregate, not just the analysis path.
- **Cost scales with the ceiling.** `analyseSampleSize` may be raised to 10, so an author with a
  heterogeneous document set can buy a wider field set. Ten documents of extracted text in one
  proposal call is a large prompt, and the setting is the one place a user can materially increase
  automatic, unprompted spend. The default stays at 3 and the per-run cost ceiling remains the
  backstop.
