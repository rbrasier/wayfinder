# v1.47.1 — Fix: attached session uploads now reach the AI

## Symptom

A user attached a document to the chat composer (e.g. `Dave.docx`, a short email
asking to purchase Office 365 licences at ~$99 each). The upload succeeded and
showed a filename pill, but when the user sent a message the AI replied that it
"couldn't see the request details" — the document content never influenced the
answer.

## Root cause

Document content reaches the chat prompt **only** through semantic RAG retrieval,
and that retrieval used a single similarity threshold (`>= 0.5`, top `5`) shared
across every document source. The user's message *"Here is the request I've been
asked to do"* is a meta-statement that is semantically dissimilar to the email
body, so the only relevant upload chunk scored below `0.5` and was filtered out —
the AI saw nothing.

The upload's full text is stored on the `session_upload` row but the chat turn
never reads it directly; it relies entirely on similarity-gated retrieval. The
underlying modelling flaw: session uploads (small, deliberately attached) were
gated by the same strict threshold as flow context docs (a large curated KB).

## Fix applied

`RetrieveDocumentChunks` now searches the two scopes independently with their own
parameters, then merges and ranks the results by similarity:

- **Flow context docs:** strict defaults retained — `minSimilarity 0.5`, `limit 5`.
- **Session uploads:** permissive defaults — `minSimilarity 0.2`, `limit 8` — so a
  deliberately-attached document reaches the prompt even when the user's wording
  is only loosely related.

The query is embedded once and reused for both scoped searches. Per-scope
overrides (`flowLimit` / `flowMinSimilarity` / `sessionLimit` /
`sessionMinSimilarity`) are exposed on the use-case input. Callers
(`stream/route.ts`, `stream/turn-helpers.ts`) needed no change — they rely on the
new defaults.

Files changed:

- `packages/application/src/use-cases/session/retrieve-document-chunks.ts`
- `packages/application/src/use-cases/session/retrieve-document-chunks.test.ts`
- `apps/web/e2e/fix-session-upload-not-reaching-ai.spec.ts` (new)

## Regression test added

`retrieve-document-chunks.test.ts` now asserts the flow scope is searched
strictly (`0.5` / `5`) and the session scope permissively (`0.2` / `8`), that both
scopes' results are merged highest-similarity-first, that a single embedding is
reused, and that per-scope overrides are honoured. These fail on the old
single-threshold code. Run: `pnpm --filter @rbrasier/application test
retrieve-document-chunks` — 7 passing.

## E2E test added

`apps/web/e2e/fix-session-upload-not-reaching-ai.spec.ts` reproduces the exact
report: attach the Dave email, send a loosely-worded message, and assert the
assistant reply reflects the document body and never falls back to "I don't see
the request details". It is driven by the /e2e Playwright MCP skill against a
running stack with real embeddings + an AI key (excluded from the vitest unit
run), so it was not executed in the fix sandbox (no infra/AI key available there);
the deterministic regression guard is the unit test above.

## Version

PATCH bump: `1.47.0` → `1.47.1` (behaviour fix, no schema change).
