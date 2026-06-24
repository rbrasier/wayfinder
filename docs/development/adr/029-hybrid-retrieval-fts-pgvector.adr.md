# ADR-029 — Hybrid Retrieval: Postgres FTS fused with pgvector

- **Status**: Proposed
- **Date**: 2026-06-23
- **Relates to**: ADR-016 (pgvector / single-Postgres goal), ADR-028 (`content_tsv` column)

## Context

Retrieval is semantic-only (cosine over `kb_document_chunks.embedding`). Semantic search is
good for broad, conceptual questions but unreliable for exact tokens — SKUs, invoice numbers,
legal codes, part numbers — where a near-miss is a wrong answer. The PRD requires a default
semantic experience plus a **forced exact match** mode, with matched keywords highlighted.

ADR-016 fixed the system goal of staying within a single Postgres instance. An external BM25
engine (OpenSearch/Elasticsearch) would deliver stronger keyword ranking but adds a service,
credentials, and ops burden that conflicts with that goal at our corpus scale.

## Decision 1 — Keyword side is Postgres full-text search, not an external engine

Use the generated `content_tsv` column (ADR-028) with `to_tsquery` / `plainto_tsquery` and
`ts_rank` for keyword ranking. No new infrastructure; retrieval stays one SQL query that can
join `app_flows` / `app_sessions` directly, exactly as ADR-016 argued for vectors.

**When to revisit:** if a deployment needs BM25-grade ranking at >1 M chunks, or
language-specific analysis Postgres FTS can't express, re-evaluate a dedicated engine
(same trigger as ADR-016 Decision 1).

## Decision 2 — Two retrieval modes behind one `IHybridRetriever` port

```ts
// packages/domain/src/ports/hybrid-retriever.ts
export type RetrievalMode = "semantic" | "exact";

export interface HybridRetrievalQuery {
  text: string;
  mode: RetrievalMode;
  scope: { flowId: string } | { sessionId: string };
  limit: number;
}

export interface IHybridRetriever {
  retrieve(query: HybridRetrievalQuery): Promise<Result<ChunkSearchResult[]>>;
}
```

- **`semantic` (default)** — fuse vector similarity and `ts_rank` (Decision 3). Broad discovery.
- **`exact`** — `content_tsv @@ phraseto_tsquery(term)` (and/or `chunk_text ILIKE`) for literal
  phrases; vector score is ignored for ranking. Returns only rows containing the literal term(s).

Mode is set from the UI: `"quoted phrases"` and an explicit toggle/facet pill both resolve to
`mode: "exact"`; bare text is `semantic`.

## Decision 3 — Score fusion: weighted normalised sum, tunable

Vector cosine similarity (0–1) and `ts_rank` (unbounded) are not comparable, so normalise
each to 0–1 within the candidate set and combine:

```
score = (vectorWeight * normVector) + (keywordWeight * normTsRank)
```

Default `vectorWeight = 0.7`, `keywordWeight = 0.3` (semantic-leaning, matching the default mode).
Weights live in runtime settings (mirroring ADR-017's settings pattern) so they can be tuned per
deployment without a deploy. Candidate generation: take top-N by vector and top-N by FTS, union,
then re-rank by the fused score — avoids scanning the whole table.

## Decision 4 — Highlighting via returned matched terms

The keyword query already knows which lexemes matched. `ChunkSearchResult` carries
`matchedTerms: string[]`; the table preview bolds those spans client-side. For exact mode this
is the literal phrase; for semantic mode it is whatever lexemes the FTS side also hit. The
guardrail requirement — "confirm the system found the term" — is satisfied without a separate
`ts_headline` round-trip, though `ts_headline` remains an option if server-side snippets are wanted later.

## Decision 5 — Inference retrieval is unchanged in shape, gains a status filter

The per-turn retrieval used by the agent stays semantic (the user's message is conceptual, not a
literal lookup) but now filters `status = 'active'` (ADR-028) and increments usage counters. The
new `exact` mode is a curation/search-surface feature, not an inference-path change. This keeps
ADR-016 Decision 5 (prompt-cache boundary) intact.

## Consequences

**Positive**
- No new infrastructure; one Postgres instance to operate (ADR-016 goal upheld).
- Exact match closes the SKU/legal-code correctness gap; highlighting builds trust.
- Fusion weights are tunable without redeploying.

**Negative**
- Postgres FTS ranking is weaker than a real BM25 engine for large/long-tail corpora.
- Two-sided candidate generation + re-rank is more complex than the current single vector query.
- `english` text-search config is a default; multilingual corpora need per-deployment config later.
