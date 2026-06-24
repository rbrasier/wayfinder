# PRD — Knowledge Base Curation & Correction

- **Status**: Draft
- **Date**: 2026-06-23
- **Author**: John Tooth
- **Target version**: 1.51.0  (bump: **MINOR** — new feature + additive schema change; see `docs/guides/versioning.md`)

## 1. Problem

Wayfinder retrieves answers from document chunks (`kb_document_chunks`, ADR-016/017)
but has no human-in-the-loop over that knowledge. When a flow gives a wrong or
stale answer, an operator has no way to flag it, and a subject-matter expert (SME)
has no surface to find the offending content, fix it, or retire it. Retrieval is
also semantic-only: there is no way to force an exact match on a SKU, legal code,
or part number, which is exactly where a wrong answer is most costly.

## 2. Users / Personas

- **Frontline worker** (procurement officer, HR manager, ops lead) — runs flows and
  occasionally sees a wrong answer. Needs to flag and correct it in seconds, in a
  familiar CRM/ticketing idiom, **without** ever seeing the words "chunk", "embedding",
  or "RAG".
- **SME / Knowledge curator** — owns the accuracy of the knowledge base. Needs to
  triage corrections, edit and archive content at scale, see what is actually being
  retrieved, and revert mistakes safely.

## 3. Goals

- A frontline worker can flag an answer, type the correct text, pick a reason, and
  submit — in one modal, without backend vocabulary.
- An SME can scan all knowledge in a sortable/filterable grid (status, content
  preview, source doc, tags, usage), edit content in a slide-out drawer, and
  bulk-archive or bulk-tag selections.
- Every edit is versioned and revertible; no edit destroys the prior text.
- An SME can jump from any chunk to its location highlighted in the source document
  ("View in Source").
- Search supports both semantic discovery (default) and forced exact match
  (`"quotes"` / toggle / facet pill), with matched keywords highlighted in results.
- A heavily-edited chunk is re-embedded so it stays in the correct semantic cluster.

## 4. Non-goals

- **Re-chunking the corpus.** The current fixed-window chunker (`text-chunker.ts`)
  is unchanged in this phase. Semantic chunking (`semchunk`) is recorded as a future
  target in ADR-030 and is explicitly out of scope here.
- A standalone, org-global knowledge base decoupled from flows. Curation extends the
  **existing flow/session-scoped** chunk model (per decision); we are not building a
  new top-level KB context.
- Approval workflow for corrections beyond a simple triage status (reuse later if needed).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `DocumentChunk` | `packages/domain/src/entities/document-chunk.ts` | **extended** | add `status`, `tags`, usage counters |
| `ChunkVersion` | `packages/domain/src/entities/chunk-version.ts` | new | append-only edit history for revert + audit |
| `AnswerFeedback` | `packages/domain/src/entities/answer-feedback.ts` | new | a frontline "Fix This Answer" submission |
| `ChunkSearchResult` | `packages/domain/src/entities/document-chunk.ts` | new | hybrid result with `matchedTerms` for highlighting |

Ports (all Result-pattern, ADR-021 boundaries):

- `IChunkCurationRepository` — list/filter, edit (writes a version), archive, tag, revert.
- `IAnswerFeedbackRepository` — submit, list/triage.
- `IHybridRetriever` — fuse vector + FTS, honour exact-match mode, return `matchedTerms`.

## 6. User stories

1. As a **frontline worker**, when I see a wrong answer in a session, I click
   "Fix This Answer", type the correct text, choose a reason, and submit — so the
   knowledge gets corrected without me learning the system internals.
2. As an **SME**, I open the curation grid, filter to `pending` feedback, and turn a
   submission into an edited/active chunk — so corrections reach future retrieval.
3. As an **SME**, I edit a chunk in a slide-out drawer; the prior text is saved as a
   version and the chunk is re-embedded — so I can revert and it stays correctly clustered.
4. As an **SME**, I select 20 stale chunks and bulk-archive them — so they stop being retrieved.
5. As an **SME**, I search `"INV-2024-001"` in exact mode and see the term highlighted
   in the matching chunk preview — so I trust the system found the literal value.
6. As an **SME**, I click "View in Source" and see the chunk's span in the original
   document — so I can confirm the boundary is sane.

## 7. Pages / surfaces affected

- `apps/web` `/knowledge` (new) — SME smart-grid + slide-out editor + hybrid search bar.
- `apps/web` session chat — "Fix This Answer" affordance on assistant messages + feedback modal.
- tRPC: `knowledge.list`, `knowledge.search`, `knowledge.update`, `knowledge.archive`,
  `knowledge.tag`, `knowledge.revert`, `knowledge.versions`, `knowledge.viewSource`;
  `feedback.submit`, `feedback.list`.
- Retrieval path (`packages/adapters/.../drizzle-document-chunks-repository.ts`) gains a
  hybrid query; the inference retrieval call filters to `status = 'active'` and bumps usage.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `kb_document_chunks` | add `status` (`active`/`archived`/`draft`, default `active`), `tags text[]`, `retrieval_count integer default 0`, `last_retrieved_at timestamptz`, `content_tsv` generated `tsvector` + GIN index | yes (`kb_`) |
| `kb_chunk_versions` | NEW — `chunk_id`, `chunk_text`, `embedding`, `edited_by`, `reason`, `created_at` (append-only) | yes (`kb_`) |
| `kb_answer_feedback` | NEW — `session_id`, `message_id`, `flagged_answer`, `corrected_text`, `reason`, `status` (`pending`/`accepted`/`dismissed`), `created_by`, timestamps | yes (`kb_`) |

Retrieval filters on `status='active'`; archived chunks are retained for audit, not retrieved.

## 9. Architectural decisions

- **Assumes**: ADR-016 (pgvector/HNSW), ADR-017 (384-d configurable embeddings, re-embed on change),
  ADR-021 (RBAC registry — new permission keys), ADR-015 (versioning snapshots, precedent for history).
- **Introduces**:
  - **ADR-028** — KB curation data model & feedback loop (extend chunks; versions + feedback tables; permissions).
  - **ADR-029** — Hybrid retrieval: Postgres FTS (`tsvector`/`ts_rank`) fused with pgvector; exact-match mode; highlighting.
  - **ADR-030** — Target chunking: Python `semchunk` sidecar behind a port (**deferred**; records intent + migration plan).

## 10. Acceptance criteria

- [ ] Frontline modal submits a `kb_answer_feedback` row with answer, corrected text, reason — no RAG vocabulary in the UI.
- [ ] SME grid lists chunks with status, preview, source doc, tags, and usage; sortable and filterable.
- [ ] Editing a chunk writes a `kb_chunk_versions` row and re-embeds the chunk (ADR-017 path).
- [ ] Revert restores a prior version's text and embedding and writes a new version (no destructive loss).
- [ ] Bulk archive/tag applies to a multi-selection in one action.
- [ ] Exact-match mode (`"quotes"` / toggle) returns only literal matches; matched terms are highlighted in previews.
- [ ] Default search fuses vector + FTS ranking.
- [ ] "View in Source" opens the source document with the chunk span anchored.
- [ ] Inference retrieval excludes `archived` chunks and increments usage counters.
- [ ] New permission keys gate the frontline vs SME surfaces (ADR-021).
- [ ] `VERSION` and root `package.json#version` both read `1.51.0`; `./validate.sh` passes.

## 11. Out of scope / future work

- Semantic (`semchunk`) re-chunking and its re-embedding migration — ADR-030, later phase.
- Cross-flow / org-global knowledge promotion.
- Time-windowed usage analytics ("retrieved 50× *this week*") beyond a lifetime counter +
  `last_retrieved_at`; a `kb_chunk_retrieval_events` table is a deferred enhancement.
- SME approval chains on corrections.

## 12. Risks / open questions

- **Boundary trust**: with the current fixed-window chunker, "View in Source" anchors a
  window, not a complete thought — mitigated, not solved, until ADR-030 lands.
- **Usage write amplification**: bumping `retrieval_count` on every retrieval adds a write
  per turn; batch or async if it shows up under load (ADR references the scaling phase).
- **FTS + 384-d fusion weighting**: the score-fusion weighting (vector vs `ts_rank`) needs a
  default and a tuning knob — settled in ADR-029.
- **Feedback → chunk mapping**: a flagged answer may not map cleanly to one chunk; Phase 1
  stores feedback against the session/message and lets the SME attach it to a chunk during triage.
