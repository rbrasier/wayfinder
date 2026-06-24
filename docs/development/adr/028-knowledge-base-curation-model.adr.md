# ADR-028 — Knowledge Base Curation Data Model & Feedback Loop

- **Status**: Proposed
- **Date**: 2026-06-23
- **Relates to**: ADR-016 (pgvector RAG), ADR-017 (configurable embeddings / re-embed on change),
  ADR-021 (RBAC permission registry), ADR-015 (versioning snapshots)

## Context

Retrieval today (`kb_document_chunks`) is write-once at upload and read-only at inference.
There is no lifecycle, no human correction path, and no audit. The
Knowledge Base Curation PRD adds two human roles — a frontline worker who flags wrong
answers and an SME who curates content — and requires status, tags, usage, versioning,
and revert.

Per decision, we **extend the existing flow/session-scoped chunk model** rather than
introduce a new org-global knowledge context. This keeps one retrieval table and one
scope model, at the cost of curating content that is still scoped per flow/session.

## Decision 1 — Extend `kb_document_chunks` with a curation lifecycle

Add to `kb_document_chunks`:

- `status text` — `active` | `archived` | `draft`, default `active`. **Inference retrieval
  filters to `active`.** Archived rows are retained for audit, never retrieved.
- `tags text[]` default `'{}'` — SME-applied labels, used for faceting and bulk ops.
- `retrieval_count integer` default `0`, `last_retrieved_at timestamptz` — usage metrics.
- `content_tsv tsvector` **generated** from `chunk_text` (`to_tsvector('english', chunk_text)`),
  with a GIN index — the keyword side of hybrid search (ADR-029).

`status`, `tags`, and usage are additive and nullable/defaulted, so existing rows migrate
cleanly. The `scope_check` (exactly one of `flow_id`/`session_id`) is unchanged.

## Decision 2 — Append-only version history in `kb_chunk_versions`

Every edit and every revert writes a row capturing the text **as it was before the change**:

```
kb_chunk_versions
  id           uuid pk
  chunk_id     uuid -> kb_document_chunks(id) on delete cascade
  chunk_text   text not null        -- the superseded text
  embedding    vector(384) not null -- the superseded embedding (revert is exact)
  edited_by    uuid -> core_users(id)
  reason       text                 -- optional edit note / feedback link
  created_at   timestamptz not null default now()
  updated_at   timestamptz not null default now()
```

Revert = read the chosen version, write the *current* text as a new version, then restore the
version's text and embedding onto the chunk. No update ever destroys prior text. This mirrors
ADR-015's snapshot precedent rather than inventing a new history mechanism.

## Decision 3 — Frontline corrections land in `kb_answer_feedback`, decoupled from chunks

A "Fix This Answer" submission is **not** a direct chunk edit — the flagged answer may span
several chunks or none. Capture it raw and let the SME resolve it during triage:

```
kb_answer_feedback
  id              uuid pk
  session_id      uuid -> app_sessions(id) on delete cascade
  message_id      uuid                 -- the assistant message flagged
  flagged_answer  text not null        -- what the system said
  corrected_text  text not null        -- what the worker says is right
  reason          text not null        -- enum-ish: outdated | wrong | incomplete | other
  status          text not null default 'pending'  -- pending | accepted | dismissed
  created_by      uuid -> core_users(id)
  created_at / updated_at timestamptz
```

Triage flow: SME reviews `pending` → optionally edits a target chunk (Decision 2) or creates a
`draft` chunk from `corrected_text` → marks feedback `accepted`/`dismissed`. The mapping from
feedback to chunk is a human decision in Phase 1, not an automatic match.

## Decision 4 — Re-embed on heavy edit (semantic drift), reusing ADR-017

When an SME edits chunk text, the chunk is re-embedded through the existing
`IEmbeddingsProvider` (ADR-017) so it stays in the correct cluster. The stored
`extracted_text` / source remains the source of truth, consistent with ADR-016 Decision 4.
"Heavy" vs trivial is not auto-detected in Phase 1 — any content edit triggers a re-embed;
the "Auto-Tag/Re-evaluate" button in the PRD is the explicit user-facing trigger.

## Decision 5 — Two new RBAC permission keys (ADR-021)

Add to the developer-owned registry in `packages/domain/src/entities/permission.ts`:

- `knowledge:submit_feedback` — gates the frontline "Fix This Answer" modal.
- `knowledge:curate` — gates the SME grid: edit, archive, tag, revert, view usage, view source.

Admins hold the full registry by wildcard (existing behaviour). No new role type is invented;
admins assign these keys to roles as usual. A permission with no enforcing code is meaningless
(ADR-021), so both keys are enforced in the tRPC procedures and the UI gates off the same checks.

## Consequences

**Positive**
- One retrieval table and one scope model; no parallel KB subsystem to keep in sync.
- Full audit trail and non-destructive revert satisfy the governance guardrails.
- Feedback decoupled from chunks avoids brittle answer→chunk auto-mapping.

**Negative**
- Curated content stays flow/session-scoped — knowledge cannot yet be shared org-wide
  (revisit if a global KB is needed).
- `content_tsv` + GIN and `kb_chunk_versions` (carrying a vector per version) grow storage.
- Usage counters add a write per retrieved chunk per turn (see the scaling phase).
