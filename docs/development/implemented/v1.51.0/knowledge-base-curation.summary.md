# Implementation Summary — Knowledge Base Curation & Correction (v1.51.0)

- **Version bump**: MINOR — 1.50.0 → 1.51.0 (new feature + additive schema change)
- **PRD**: `docs/development/prd/knowledge-base-curation.prd.md`
- **ADRs**: ADR-028 (curation data model & feedback), ADR-029 (hybrid retrieval), ADR-030 (semchunk — deferred target)

## What was built

A governed correction-and-curation loop over the existing flow/session-scoped
pgvector RAG layer:

- **Frontline "Fix This Answer"** — assistant messages gain a low-key affordance
  (gated by `knowledge:submit_feedback`) opening a modal: read-only flagged answer,
  corrected text, reason, submit. No RAG vocabulary is exposed.
- **SME curation grid** (`/knowledge`, gated by `knowledge:curate`) — pick a flow,
  scan chunks (content preview, source doc, status, tags, usage), slide-out drawer
  to edit (re-embeds via ADR-017), version history with revert, "View in source"
  anchor, bulk archive/restore/tag, and a pending-corrections triage table.
- **Hybrid search** — Postgres FTS (`tsvector`/`ts_rank`) fused with pgvector,
  min-max normalised per ADR-029; semantic (default) and exact (`"quotes"`/toggle)
  modes; matched terms bolded in previews.
- **Inference path** — per-turn retrieval now filters `status = 'active'` and bumps
  usage counters (failure to bump never breaks retrieval).

## Files created

**Migration**
- `packages/adapters/drizzle/0026_volatile_stellaris.sql`

**Domain** (`packages/domain/src`)
- `entities/chunk-version.ts`, `entities/answer-feedback.ts`
- `entities/document-chunk.ts` — added `ChunkStatus`, `CuratedChunk`, `ChunkSearchResult`
- `ports/chunk-curation-repository.ts`, `ports/answer-feedback-repository.ts`, `ports/hybrid-retriever.ts`
- `entities/permission.ts` — added `knowledge:submit_feedback`, `knowledge:curate`

**Application** (`packages/application/src/use-cases`)
- `feedback/` — submit / list / triage (+ `feedback.test.ts`)
- `knowledge/` — list / search / edit / set-status / tag / revert / list-versions (+ `knowledge.test.ts`)

**Adapters** (`packages/adapters/src`)
- `repositories/drizzle-chunk-curation-repository.ts` (transactional edit/revert)
- `repositories/drizzle-answer-feedback-repository.ts`
- `repositories/drizzle-hybrid-retriever.ts` (FTS + pgvector fusion)
- `db/schema/wayfinder.ts` — extended `kb_document_chunks`; new `kb_chunk_versions`, `kb_answer_feedback`

**Web** (`apps/web/src`)
- `server/routers/knowledge.ts`, `server/routers/feedback.ts` (+ registered in `server/router.ts`)
- `lib/container.ts` — wired three repositories and ten use-cases
- `app/(user)/knowledge/page.tsx`, `app/(user)/knowledge/_content.tsx`
- `components/chat/fix-answer-modal.tsx`
- `components/chat/message-feed.tsx`, `app/(user)/chats/[sessionId]/_content.tsx` — feedback affordance
- `components/sidebar.tsx` — permission-gated "Knowledge" nav item

## Files modified (behavioural)

- `repositories/drizzle-document-chunks-repository.ts` — `status='active'` filter + `bumpUsage`
- `entities/permission.test.ts`, `use-cases/role/role.test.ts` — assert the two new keys

## Migrations run

`0026_volatile_stellaris.sql` was **generated** (`drizzle-kit generate`) and verified by
inspection. It was **not applied** in this environment — no Postgres image was reachable
(registry rate-limited). Apply with `pnpm db:migrate` against a pgvector-enabled Postgres
before use.

## e2e tests added

`apps/web/e2e/phase-knowledge-base-curation.spec.ts`:
- Frontline: submit a correction → "thanks for the fix"; assert no RAG vocabulary; required-field block.
- SME: edit a chunk → prior text appears in version history with a revert button.
- SME: exact-match search highlights the literal term (`<mark>`).

## Known limitations

- **Not run against a live DB in this environment.** `validate.sh` passed all 14 checks
  except the drizzle schema check, which **SKIP**s when Postgres is unreachable (by design).
  The Playwright e2e requires a running stack + seeded fixtures and was authored but not
  executed here.
- **Chunking unchanged.** Boundaries are still fixed windows; "View in source" anchors a
  window, not a complete thought, until ADR-030 (semchunk sidecar) is implemented.
- **Curation is flow/session-scoped**, not org-global (per the chosen model).
- **Usage metrics** are a lifetime counter + `last_retrieved_at`; time-windowed analytics
  (`kb_chunk_retrieval_events`) are deferred.
- **Feedback → chunk mapping** is a manual triage step (accept/dismiss); auto-linking a
  correction to a chunk is future work.
