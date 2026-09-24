# Implementation summary — remove Synthesise "Publish"; full runs version themselves

- **Version**: 0.28.23 → **0.28.24** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Phase doc**: [`synthesise-remove-publish-button.phase.md`](./synthesise-remove-publish-button.phase.md)
- **Source issue**: #303 (left open for sharing)
- **Relates to**: ADR-033 §3/§6, ADR-015

## What shipped

The "Edit synthesis" header no longer shows a Publish button that could never
be pressed. "Start run" on the Runs page, which previously failed for any
synthesis that had never been published, now works: starting a full run locks
the author's saved schema as the next numbered version and runs on it.

## Behaviour

| Condition at "Start run" | Result |
| --- | --- |
| Schema saved since the last full run (open draft) | draft promoted to the next published version, audited `flow.version.published` with `trigger: "batch_run"`; run pinned to it |
| Nothing saved since (no draft, published exists) | run pinned to the latest published version; no new version |
| Never saved | rejected — "Save the synthesis before running a full batch." |
| Intake rejected (no files / over the file limit) | rejected before any version is minted |

Samples are unchanged — they still run on the draft. After a full run consumes
the draft, the editor shows the published schema and the next Save opens a new
draft.

## Also removed

- `extraction.publish` tRPC procedure (its only caller was the button).
- "Requires a published synthesis." on the Runs page.
- The DRAFT/PUBLISHED badge on the user and admin `/synthesise` lists, and
  `status` from `ExtractionFlowRow` — without publishing or sharing it carried
  no meaning and always read DRAFT.

## Files

- `packages/application/src/use-cases/extraction/start-batch-run.ts` —
  `resolveRunnableVersion` + `pinVersion` replace `loadPublishedSchema`; new
  required `IAuditLogger` constructor argument.
- `apps/web/src/lib/container-extraction.ts` — passes `auditLogger`.
- `apps/web/src/server/routers/extraction.ts` — `publish` removed.
- `apps/web/src/components/extraction/editor-cards.tsx`,
  `extraction-list.tsx`, `app/(user)/synthesise/_content.tsx`,
  `app/(admin)/admin/synthesise/_content.tsx`,
  `app/(user)/synthesise/[id]/runs/_content.tsx` — UI removals.

## Tests

- `start-batch-run.test.ts` — five new `execute` cases: draft promoted and
  audited, published reused with no mint, neither rejected, rejected intake
  mints nothing, promotion failure creates no run.
- `batch-engine.test.ts` — fake repository gains `openDraft`; constructor
  sites take the audit logger; the no-schema case asserts the new message.
- **No e2e** — behaviour is owned by `packages/application`; none of the six
  `e2e-test-policy.md` groups apply.

## Known limitations

- A user holding `extraction:run` (but not `extraction:author`) who owns a
  synthesis now mints versions by running it; ADR-033 §7 lists publishing under
  `extraction:author`. Only owners/admins reach `startBatch`, and they already
  edit the schema.
- Sharing remains undefined — tracked on #303.

## Deviations from the approved summary

- Removing the list badge (`ExtractionFlowRow.status`) was agreed at the
  approval gate and also touches the admin `/admin/synthesise` list.
- Added a fifth unit case (promotion failure) beyond the four planned.
