# Implementation Summary — Auto Analyse for Synthesise Information

- **Version**: 0.37.0 (MINOR — new feature plus a schema change)
- **Phase doc**: `auto-analyse-synthesis.phase.md` (same folder)
- **PRD**: `docs/development/prd/auto-analyse-synthesis.prd.md`
- **ADRs**: ADR-059, ADR-060 (ADR-052 superseded)
- **Source issue**: #296

## What was built

Uploading input documents to a Synthesise Information flow now starts a background
analysis run. It reads up to ten of them, proposes an extraction field set — labels, types and
instructions — and writes it straight into the open draft, where the author edits it by hand like
any other field. A toggle in the Input card header turns this on by default and hides the two
questions non-technical authors cannot answer; the AI's answer to both is "one file, one record".

Analysis is a third extraction run mode rather than a new aggregate, so it inherits the run
status vocabulary, the cost ceiling, cancellation and the retention sweep unchanged.

## Files created

| Path | What it is |
| ---- | ---------- |
| `packages/domain/src/ports/field-proposer.ts` | `IFieldProposer`, `FieldProposalRequest`, `ProposalDocument` |
| `packages/application/src/use-cases/extraction/merge-proposed-fields.ts` | Append-and-fill merge |
| `packages/application/src/use-cases/extraction/propose-extraction-fields.ts` | Read, propose, merge, settle |
| `packages/application/src/use-cases/extraction/merge-proposed-fields.test.ts` | 10 tests |
| `packages/application/src/use-cases/extraction/propose-extraction-fields.test.ts` | 13 tests |
| `packages/application/src/use-cases/extraction/analyse-run-engine.test.ts` | 8 tests |
| `packages/adapters/src/ai/ai-field-proposer.ts` | `IFieldProposer` over the language model |
| `packages/adapters/drizzle/0052_eminent_gunslinger.sql` | The migration |
| `packages/shared/src/schemas/extraction.test.ts` | 6 tests |
| `apps/web/src/components/extraction/auto-analyse-panel.tsx` | Toggle, stepper, analysis states |
| `apps/web/src/components/extraction/auto-analyse-model.test.ts` | 13 tests |

## Files modified

- **domain** — `extraction-schema.ts` (`autoAnalyse`, `analyseSampleSize`, `MAX_ANALYSE_DOCUMENTS`,
  `DEFAULT_ANALYSE_DOCUMENTS`, `isAutoAnalyseOn`, `analyseDocumentCount`), `extraction-run.ts`
  (`"analyse"` mode, nullable `flowVersionId`, `isAnalysisRun`), `template-field.ts`
  (`VALID_ANNOTATIONS_HINT` exported), `extraction-run-repository.ts` (claim/settle/release),
  both index files.
- **application** — `start-batch-run.ts` (`startAnalysis`), `advance-batch-runs.ts` (analyse
  branch), `run-schema.ts` (null-aware), `batch-engine.test.ts` (drafts dependency).
- **adapters** — `db/schema/wayfinder.ts`, `drizzle-extraction-run-repository.ts`, `ai/index.ts`.
- **apps** — `server/routers/extraction.ts`, `editor-cards.tsx`, `editor-cards-controls.tsx`,
  `extraction-editor-model.ts`, the artifact download route, both containers.

## Migration

`0052_eminent_gunslinger.sql`, declared `-- data-impact: preserved`:

```sql
ALTER TABLE "app_extraction_runs" ALTER COLUMN "flow_version_id" DROP NOT NULL;
ALTER TABLE "app_extraction_runs" ADD COLUMN "analysis_claimed_at" timestamp with time zone;
```

Both widen what a row may hold. No existing row changes value; the new column reads null, which is
exactly "no worker holds a claim". `mode` needed no SQL — it is plain `text` with no check
constraint.

## Deviations from the approved plan

1. **`analysis_claimed_at` was added.** The plan said one migration containing only `DROP NOT NULL`.
   A run-level claim needs somewhere to record who holds it; without it the exactly-once guarantee
   is unenforceable and two overlapping ticks would both run the analysis and double-spend.
2. **`VALID_ANNOTATIONS_HINT` is exported from domain rather than sourced by `@wayfinder/shared`.**
   Phase step 4 assumed shared could read the constant; it cannot import domain. The annotation
   list travels in the prompt instead, and the zod schema describes only the shape.
3. **UI coverage is pure-model tests, not component tests.** The plan named
   `apps/web/**/*.test.tsx`; `apps/web` has no such file and no testing-library or jsdom
   dependency, so component tests are not wired in this repo. The UI decisions were extracted into
   `extraction-editor-model.ts` and tested there, matching the existing `sidebar-model.test.ts`
   pattern.
4. **`editor-cards.tsx` was split.** The additions pushed it to 872 lines, over validate.sh's 800
   line limit, so the Auto Analyse UI moved to `auto-analyse-panel.tsx`.
5. **The nullable `flowVersionId` audit found five readers, not four.** The fifth was the
   run-artifact download route in `apps/web`.
6. **Auto Analyse does not default on for every existing flow.** Absence of the setting is read as
   "on" only where turning it on changes nothing. A saved config already using many-files-per-record
   would otherwise be forced to one-file-per-record and lose its selection criteria. Three
   pre-existing tests caught this.

## Tests

- domain 26 + 28, shared 6, application 1327 (31 new), adapters 1078, web 713 (13 new).
- `./validate.sh`: 25 passed, 0 failed.

**No e2e spec.** Under `docs/guides/e2e-test-policy.md` none of the six groups is met: the
file-upload boundary is already covered by existing specs and this adds no new file-dialog or
download path. Coverage sits at `packages/application` (merge, propose, claim) and
`apps/web` pure-model tests (control visibility, the six analysis states).

## Known limitations

- **Durability depends on the deployment.** Only `apps/api` with `EXTRACTION_WORKER_ENABLED=true`
  advances an analysis with no tab open. In a web-only deployment the editor drives it through
  `extraction.tick`, so closing the tab stalls the analysis until the editor is reopened. This is
  how sample runs already behave.
- **The cost ceiling is checked once, before the claim.** A run that starts under the ceiling can
  finish over it, bounded by one analysis of at most ten documents (ADR-060 §4).
- **No per-document retry.** A failure partway through discards the reads already done and retries
  the whole claim.
- **Each document is truncated to 6,000 characters.** Structure lives at the top; a field that only
  appears deep in a long document will not be proposed.
- **No re-analysis on later uploads.** Adding documents to an already-drafted synthesis starts a new
  analysis, but existing fields are never modified, so a materially different document set needs
  hand-editing.
- **`doneWhen` is never proposed** — a completion criterion is the author's judgement, not the
  documents'.
