# ADR-030 — Target Chunking Strategy: `semchunk` Sidecar (Deferred)

- **Status**: Proposed — **target / deferred** (no code in the v1.51.0 phase)
- **Date**: 2026-06-23
- **Relates to**: ADR-016 (re-embedding strategy), ADR-017 (configurable embeddings)

## Context

Chunking today (`packages/adapters/src/extraction/text-chunker.ts`) splits extracted text into
fixed ~500-token windows with ~50-token overlap. Fixed windows cut mid-thought, producing the
"Frankenstein chunk" the curation PRD calls out: an SME viewing a chunk in source sees an
arbitrary span, not a complete idea, and retrieval can surface half an argument.

The named target is **`semchunk`** — semantic chunking that splits on shifts in meaning, yielding
"complete thoughts". `semchunk` is a **Python** library; Wayfinder's adapters are TypeScript/Node.
This ADR records the chosen direction and its migration cost so a later phase can execute it; it
is **explicitly out of scope** for the curation phase (v1.51.0), which leaves the chunker untouched.

## Decision 1 — Adopt `semchunk` behind a sidecar service, not in-process

Run `semchunk` as a small Python sidecar exposed over HTTP, called by a TypeScript adapter that
implements a domain port:

```ts
// packages/domain/src/ports/chunker.ts  (future)
export interface IChunker {
  chunk(text: string): Promise<Result<string[]>>;
}
```

- The adapter (`packages/adapters/src/extraction/semchunk-adapter.ts`) POSTs text to the sidecar
  and returns the segments; failures map to a `DomainError` (Result pattern, never throw across
  the boundary).
- The current `chunkText` becomes the fallback `IChunker` implementation if the sidecar is
  unreachable, so indexing degrades rather than fails.

**Why a sidecar, not a TS reimplementation:** the requirement names `semchunk` specifically and we
want its behaviour, not an approximation. A sidecar keeps the Python dependency isolated behind a
port and out of the Node runtime. This is a deliberate, contained exception to the single-stack
preference — the only network dependency is internal and optional.

**Trade-off acknowledged:** this adds a service to the deployment topology (a new container,
healthcheck, and the indexing path now has a network hop). For air-gapped builds the sidecar image
must be baked in, as with the local embedding model (ADR-017). If operational cost outweighs chunk
quality in practice, the fallback in-process chunker can remain the default and the sidecar made opt-in.

## Decision 2 — Adoption is a re-embedding migration (ADR-016 Decision 4)

Changing chunk boundaries invalidates every existing `kb_document_chunks` row. Adoption therefore
runs as a planned migration, reusing ADR-016's re-embedding machinery:

1. The stored `extracted_text` / source documents are the source of truth (no re-upload needed).
2. For each source: re-chunk via the sidecar, delete old chunks for that `storage_path`, insert new
   chunks, and embed each via the active `IEmbeddingsProvider` (ADR-017).
3. `kb_chunk_versions` and curated `status`/`tags` (ADR-028) do **not** survive boundary changes
   cleanly — a chunk's identity changes. The migration must define how curation state is carried
   forward (e.g. re-apply by source span overlap, or treat curated chunks as pinned overrides).
   **This is the main open question and the reason the work is deferred to its own phase.**

## Decision 3 — Not in the v1.51.0 curation phase

The curation phase ships against today's chunker. Adopting `semchunk` is sequenced after curation
ships, because:

- It needs the re-embedding migration above, which is disruptive (maintenance window).
- It interacts with curated state (Decision 2's open question) that only exists once ADR-028 lands.
- Curation delivers user value (correction loop, exact search, audit) without it.

## Consequences

**Positive**
- Records a concrete, named target so the chunking decision isn't relitigated later.
- Sidecar isolates the Python dependency behind a Result-pattern port; fallback keeps indexing alive.
- Defers disruption until after the curation loop exists to benefit from it.

**Negative**
- A future service in the topology (container, healthcheck, baked-in image for air-gapped builds).
- A disruptive re-embedding migration when adopted.
- Unresolved: how curated `status`/`tags`/version history map onto re-cut boundaries — must be
  designed in the adoption phase before this ADR moves to Accepted.
