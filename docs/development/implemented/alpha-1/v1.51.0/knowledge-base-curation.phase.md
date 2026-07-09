# Phase — Knowledge Base Curation & Correction

- **Status**: To be implemented (run `/doc-review` before `/build`)
- **Target version**: **MINOR** — 1.50.0 → 1.51.0 (new feature + additive schema change)
- **PRD**: `docs/development/prd/knowledge-base-curation.prd.md`
- **ADRs**: ADR-028 (curation data model & feedback), ADR-029 (hybrid retrieval), ADR-030 (semchunk — deferred)
- **Depends on**: ADR-016 / ADR-017 (RAG + embeddings), ADR-021 (RBAC registry)

## 1. Goal

Add a governed correction-and-curation loop over the existing flow/session-scoped RAG chunks:
frontline workers flag and correct wrong answers; SMEs triage, edit, archive, tag, version, and
revert at scale; search gains a forced exact-match mode with highlighting. The chunker is **not**
changed (ADR-030 is deferred).

## 2. Scope

**In:** feedback capture, SME grid + drawer editor, version history + revert, status lifecycle,
tags, usage counters, hybrid (semantic + exact) search, "View in Source" anchor, re-embed-on-edit,
two new permission keys.

**Out:** semchunk re-chunking (ADR-030), org-global KB promotion, time-windowed usage analytics,
SME approval chains. (PRD §4 / §11.)

## 3. Database changes (one Drizzle migration)

Extend `kb_document_chunks` (ADR-028 Decision 1):

- `status text not null default 'active'` (`active`|`archived`|`draft`)
- `tags text[] not null default '{}'`
- `retrieval_count integer not null default 0`, `last_retrieved_at timestamptz`
- `content_tsv tsvector` generated `to_tsvector('english', chunk_text)` + GIN index

New tables (group prefix `kb_`, every table has `id`/`created_at`/`updated_at`):

- `kb_chunk_versions` — append-only history (ADR-028 Decision 2).
- `kb_answer_feedback` — frontline submissions (ADR-028 Decision 3).

## 4. What is built (by layer — respects hexagonal boundaries)

| Layer | File(s) | Change |
|-------|---------|--------|
| domain | `entities/document-chunk.ts` | add `status`, `tags`, `retrievalCount`, `lastRetrievedAt`; add `ChunkSearchResult` (`matchedTerms`) |
| domain | `entities/chunk-version.ts`, `entities/answer-feedback.ts` | new entities |
| domain | `ports/chunk-curation-repository.ts`, `ports/answer-feedback-repository.ts`, `ports/hybrid-retriever.ts` | new ports (Result pattern) |
| domain | `entities/permission.ts` | add `knowledge:submit_feedback`, `knowledge:curate` to the registry |
| application | `use-cases/knowledge/*`, `use-cases/feedback/*` | submit feedback, list/triage; list/edit/archive/tag/revert/versions; hybrid search |
| adapters | `db/schema/wayfinder.ts` | column additions + two new tables + migration |
| adapters | `repositories/drizzle-chunk-curation-repository.ts`, `drizzle-answer-feedback-repository.ts` | implement ports |
| adapters | `repositories/drizzle-document-chunks-repository.ts` | hybrid query; `status='active'` filter + usage bump on inference retrieval |
| apps/web | `trpc/routers/knowledge.ts`, `trpc/routers/feedback.ts` | procedures gated by the new permission keys |
| apps/web | `/knowledge` page: smart-grid, slide-out drawer, hybrid search bar, version panel, View-in-Source | SME surface |
| apps/web | session chat | "Fix This Answer" affordance + feedback modal (no RAG vocabulary) |

`lib/container.ts` wires the new repositories/use-cases.

## 5. Implementation order (tests first — tests are the spec)

1. **Migration + schema**: extend `kb_document_chunks`, add `kb_chunk_versions`, `kb_answer_feedback`. Verify with a repository round-trip test.
2. **Domain**: entities + ports + permission keys (+ tests).
3. **Feedback loop** (smallest vertical slice): `feedback.submit` use-case → repository → tRPC → "Fix This Answer" modal.
4. **Curation read**: `knowledge.list` (filter/sort) → grid + drawer (read-only first).
5. **Curation write**: edit (writes version + re-embeds via ADR-017), archive, tag, revert; bulk variants.
6. **Hybrid search**: `IHybridRetriever` adapter (vector ∪ FTS, fusion weights), exact mode, `matchedTerms` highlighting (ADR-029).
7. **Inference path**: add `status='active'` filter + usage bump to the existing retrieval query.
8. **View in Source**: anchor the chunk span in the source document viewer.
9. **Version bump**: `VERSION` + root `package.json#version` → `1.51.0`; run `./validate.sh`, fix all failures.

## 6. ADRs required

- ADR-028, ADR-029 — drive this phase.
- ADR-030 — recorded as the deferred chunking target; **no code here**.

## 7. Risks / open questions (from PRD §12)

- "View in Source" anchors a fixed window, not a complete thought, until ADR-030 lands.
- Usage-counter write amplification per retrieved chunk per turn — batch/async if load shows it.
- FTS↔vector fusion weighting default (0.7/0.3) needs validation against real queries.
- Feedback→chunk mapping is a human triage step in Phase 1, not automatic.

## 8. Acceptance criteria

Mirror PRD §10:

- [ ] Frontline modal writes `kb_answer_feedback` with no RAG vocabulary surfaced.
- [ ] SME grid: status, preview, source doc, tags, usage; sortable/filterable.
- [ ] Edit writes a `kb_chunk_versions` row and re-embeds the chunk.
- [ ] Revert restores prior text + embedding without destroying current text.
- [ ] Bulk archive/tag works on a multi-selection.
- [ ] Exact mode returns only literal matches; matched terms highlighted.
- [ ] Default search fuses vector + FTS.
- [ ] "View in Source" anchors the chunk span.
- [ ] Inference retrieval excludes `archived` and bumps usage.
- [ ] `knowledge:submit_feedback` / `knowledge:curate` gate the two surfaces.
- [ ] `VERSION` == `package.json#version` == `1.51.0`; `./validate.sh` passes.
