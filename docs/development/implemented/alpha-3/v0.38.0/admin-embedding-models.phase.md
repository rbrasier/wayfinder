# Phase — Admin-Selectable Embedding Models

- **Status**: Implemented (v0.38.0) — see `admin-embedding-models.summary.md`
- **Target version**: 0.38.0 (bump: MINOR — schema change: vector columns widen to 1024 and gain
  `embedding_model`)
- **Base branch**: `main` (release line `alpha-3`)
- **Source issue**: rbrasier/wayfinder#336 (split from #332, part D)
- **PRD**: none — an enhancement to the knowledge-base retrieval stack. The issue is the
  requirement; `docs/development/prd/knowledge-base-curation.prd.md` covers the chunk lifecycle
  this phase stamps.
- **ADRs**: ADR-016 (knowledge-base embeddings), ADR-017 (configurable embedding providers —
  amended by this phase), ADR-028 (chunk curation and version history), ADR-056 §4 (local
  runtime availability per artefact)

## 1. Problem

An admin can switch embeddings between the in-process MiniLM model and OpenAI, and nothing else:

- `EMBEDDINGS_PROVIDERS` is `["local", "openai"]`, and `setEmbeddingsConfig` takes only a
  provider — the model is always `EMBEDDINGS_DEFAULT_MODELS[provider]`.
- The OpenAI embeddings adapter and the embeddings connectivity probe are both built with
  `env.OPENAI_API_KEY`. The OpenAI key an admin saves in the AI provider settings is never read
  for embeddings, yet the dialog tells them "OpenAI also requires an OpenAI API key to be
  configured" — an admin who sets the key in the UI gets a failing re-index.
- `kb_document_chunks.embedding` and `kb_chunk_versions.embedding` are `vector(384)`. Mistral's
  `mistral-embed` (1024, fixed) and Bedrock Titan v2 (256/512/1024) cannot produce 384, so no
  provider beyond OpenAI can be added without a column change.
- The `IEmbeddingsProvider` port comment still describes ADR-016's 1536-dim OpenAI model.

There is also no way to tell that stored embeddings are out of step with the configured model.
ADR-017 Decision 3 relies on the admin remembering to re-index after a switch; nothing records
which model produced a chunk.

## 2. Goals

- An admin chooses an embedding provider **and** model from a curated list in the RAG Embeddings
  card: local MiniLM, OpenAI 3-small / 3-large, Mistral `mistral-embed`, Bedrock Titan v2.
- Each provider's embeddings use that provider's key from the AI provider settings
  (`AiConfig.apiKeys`), with the env var as fallback, taking effect without a restart.
- Upgrading an existing deployment needs **no admin action**: every vector stored today keeps
  matching queries after the migration.
- Every chunk records the model that embedded it. When any active document was embedded with a
  model other than the configured one, admins are told, and re-indexing clears the warning.
- The misleading dialog copy and the stale port comment are corrected.

## 3. Non-goals

- Cohere on Bedrock. `@ai-sdk/amazon-bedrock` 1.1.6 sends Titan's body shape
  (`{ inputText, dimensions, normalize }`) for every model id, so Cohere's
  `{ texts, input_type }` cannot be sent through it. Follow-up.
- OpenAI-compatible / Azure endpoints, free-text model ids.
- An embeddings-only API key separate from the LLM key.
- Automatic re-indexing. Re-indexing stays an explicit admin action (surprise API spend and load
  after an upgrade are worse than a visible prompt).

## 4. Design

### 4.1 Model catalogue (`packages/shared/src/schemas/embeddings.ts`)

```typescript
export const EMBEDDINGS_PROVIDERS = ["local", "openai", "mistral", "bedrock"] as const;
export const EMBEDDINGS_DIMENSION = 1024; // stored column width

export interface EmbeddingsModelOption {
  id: string;
  label: string;
  // What the provider is asked for / returns. Shorter vectors are zero-padded to
  // EMBEDDINGS_DIMENSION, which leaves cosine similarity unchanged.
  nativeDimension: number;
}

export const EMBEDDINGS_MODELS: Record<EmbeddingsProvider, readonly EmbeddingsModelOption[]>;
```

| Provider | Model id | Native dims | How |
|---|---|---|---|
| local | `onnx-community/all-MiniLM-L6-v2-ONNX` | 384 | native, padded |
| openai | `text-embedding-3-small` | 384 | `dimensions: 384` (as today), padded |
| openai | `text-embedding-3-large` | 1024 | `dimensions: 1024` |
| mistral | `mistral-embed` | 1024 | native |
| bedrock | `amazon.titan-embed-text-v2:0` | 1024 | `dimensions: 1024` |

`text-embedding-3-small` deliberately stays at 384 so vectors already stored by OpenAI
deployments remain comparable after the migration — the upgrade needs no re-index.

`EMBEDDINGS_DEFAULT_MODELS[provider]` stays (first catalogue entry). New helpers:
`isEmbeddingsModel(provider, model)`, `findEmbeddingsModel(provider, model)`, and
`embeddingsModelKey({ provider, model }) => "provider:model"` — the value stamped on chunks.

### 4.2 Port change (`packages/domain`)

`IEmbeddingsProvider` gains a write-path method that reports the model that produced the vector,
resolved in the same call so a concurrent settings change cannot mislabel a chunk:

```typescript
export interface StoredEmbedding {
  vector: number[];
  model: string; // "provider:model"
}

export interface IEmbeddingsProvider {
  embed(text: string): Promise<Result<number[]>>;            // queries
  embedForStorage(text: string): Promise<Result<StoredEmbedding>>; // chunk writes
}
```

`NewDocumentChunk`, `ChunkEdit`, `ChunkVersion` / `NewChunkVersion` gain
`embeddingModel: string | null`. `IDocumentChunkRepository` gains:

- `countDocumentsEmbeddedWithOtherModel(modelKey: string): Promise<Result<number>>` — distinct
  `storage_path` among `active` chunks whose `embedding_model IS DISTINCT FROM modelKey`.
- `labelUnlabelledEmbeddings(modelKey: string): Promise<Result<void>>` — sets
  `embedding_model` where it is `NULL`, on chunks and chunk versions. Idempotent.

### 4.3 Write paths stamp the model

- `DocumentIndexingService` (upload, template, context doc, re-index) calls `embedForStorage`
  and writes `embeddingModel` on every chunk.
- `EditChunk` calls `embedForStorage`; the repository snapshots the prior text, embedding **and
  model** into `kb_chunk_versions`, then applies the new ones.
- `revert` restores the chosen version's model alongside its text and embedding.

### 4.4 Adapter (`packages/adapters/src/ai/embeddings-adapter.ts`)

- Builders per provider: local (unchanged), OpenAI (`createOpenAI({ apiKey }).textEmbeddingModel(id,
  { dimensions })`), Mistral (`createMistral({ apiKey }).textEmbeddingModel(id)`), Bedrock
  (`createAmazonBedrock({ region, accessKeyId, secretAccessKey }).embedding(id, { dimensions })`).
  Signatures verified in `node_modules/@ai-sdk/*` 1.x.
- Credentials are resolved per call from `getAiConfig().apiKeys` (already env-backed in
  `buildEnvAiConfig`). The adapter cache key includes a non-reversible fingerprint of the
  credential, so a saved key change builds a fresh client without a restart.
- Every vector is checked against the catalogue's `nativeDimension` and zero-padded to
  `EMBEDDINGS_DIMENSION`; a wrong-length response is an `AI_PROVIDER_FAILED` error rather than a
  corrupt row.
- A stored `{ provider, model }` pair not in the catalogue falls back to that provider's default
  model (`parseEmbeddingsConfig`), so a hand-edited setting cannot break indexing.

### 4.5 Connectivity probe

`probeEmbeddingsConnectivity` checks the configured provider's key from `AiConfig`: for OpenAI
and Mistral a missing key is a skipped result with "No <Provider> API key configured"; otherwise
it embeds a short string through the real provider. Bedrock with no saved credentials is still
tried, because its SDK falls back to the server's AWS environment. The env-only `openaiApiKey`
dependency is removed from the tester.

### 4.6 Settings router and UI

- `setEmbeddingsConfig` input becomes `{ provider, model }`; a model not in that provider's
  catalogue is `BAD_REQUEST`. The ADR-056 local-availability guard is kept.
- `getEmbeddingsConfig` additionally returns `models` (the catalogue), `nativeDimension`,
  `keyStatus` (`not-needed | configured | missing`) and `staleDocumentCount`.
- New admin query `settings.embeddingsAttention` → `{ staleDocumentCount }`, cheap enough for the
  sidebar.
- Card: Model select following the provider; summary rows Provider / Model / Native dimensions /
  Stored dimensions; amber copy "Uses the <Provider> key from the AI provider settings. Documents
  must be re-indexed before they match queries with a new model."; a missing-key warning; and,
  when `staleDocumentCount > 0`, "N documents were embedded with a different model — re-index to
  search them" above the re-index button. Re-index completion invalidates the count.
- Sidebar: a dot on the admin Settings item while `staleDocumentCount > 0`.

### 4.7 Startup label

In `container.ts`'s post-migration bootstrap block (beside the admin/role seeding), call
`labelUnlabelledEmbeddings(embeddingsModelKey(await runtimeConfig.getEmbeddingsConfig()))`. Before
this release the only way to change the model is a config change made with the previous build,
which would have required a re-index anyway, so the currently resolved config is the model that
produced every unlabelled row. Done in app code, not SQL, because the env default
(`EMBEDDINGS_PROVIDER`) is invisible to a migration.

## 5. Database

Tables `kb_document_chunks`, `kb_chunk_versions` (group `kb_`). One generated migration:

1. `DROP INDEX kb_document_chunks_embedding_hnsw_idx`.
2. Both `embedding` columns: `ALTER COLUMN embedding SET DATA TYPE vector(1024) USING
   (embedding::real[] || array_fill(0::real, ARRAY[640]))::vector(1024)` — hand-edited onto the
   generated statement, which drizzle-kit emits without `USING`.
3. `ADD COLUMN embedding_model text` (nullable) on both tables;
   `CREATE INDEX kb_document_chunks_embedding_model_idx`.
4. Recreate the HNSW index (`vector_cosine_ops`, `m = 16`, `ef_construction = 64`).

```sql
-- data-impact: preserved — 384-dim vectors are zero-padded to 1024; cosine similarity is unchanged, so existing local and OpenAI 3-small embeddings keep matching
```

Columns stay snake_case; both tables keep `id`, `created_at`, `updated_at`.

## 6. Acceptance criteria

1. Saving `{ provider: "mistral", model: "mistral-embed" }` persists it; saving
   `{ provider: "openai", model: "mistral-embed" }` is rejected with BAD_REQUEST.
2. With the OpenAI key set only in the AI provider settings (no `OPENAI_API_KEY`), OpenAI
   embeddings and the embeddings connectivity test use it.
3. Changing a saved key is used by the next embedding call without a restart.
4. Local and OpenAI 3-small vectors are stored as 1024 long, the first 384 values equal to the
   model output and the rest 0; Mistral / Titan / 3-large vectors are stored as returned.
5. A provider returning a vector of the wrong length yields `AI_PROVIDER_FAILED`, and nothing is
   written.
6. Every chunk written by indexing or editing carries `embedding_model = "provider:model"`;
   reverting restores the version's model.
7. After the migration and first boot, every pre-existing chunk is labelled with the active model
   and `staleDocumentCount` is 0.
8. After switching model, `staleDocumentCount` equals the number of active documents; the card
   and sidebar show the warning; after a successful re-index it returns to 0.
9. The migration-safety test passes with the declared data-impact line.

## 7. Tests (written before implementation)

- `packages/shared/src/schemas/embeddings.test.ts` — catalogue shape, `isEmbeddingsModel`,
  `embeddingsModelKey`, defaults are catalogue members.
- `packages/adapters/src/ai/embeddings-adapter.test.ts` — padding, wrong-length rejection,
  per-provider dispatch, credentials from AI config, cache rebuilt on key change,
  `embedForStorage` reports the model.
- `packages/adapters/src/config/runtime-config-defaults.test.ts` — unknown model falls back.
- `packages/adapters/src/health/connectivity-probes.test.ts` — per-provider key checks.
- `packages/adapters/src/extraction/document-indexing-service.test.ts`,
  `packages/application/src/use-cases/knowledge/edit-chunk.test.ts` — model stamped.
- The repo has no database-backed repository tests for the chunk repositories; the migration and
  padding were verified by hand against Postgres 16 + pgvector 0.6 (see the summary).
- `apps/web/src/components/settings/embeddings-provider-state.test.ts` — model options per
  provider, stale/missing-key messages.
- `apps/web/src/server/routers/settings.test.ts` — model validation and key status.
- `apps/web/src/lib/container-embeddings.test.ts` — startup label.

**No e2e.** A settings form plus adapter logic falls in none of the six groups of
`docs/guides/e2e-test-policy.md`; coverage sits at the shared, application, adapter and component
layers.

## 8. Risks

- The migration rewrites every embedding row and rebuilds the HNSW index: long migration and a
  table lock on large knowledge bases. Documented in the release notes.
- Vector storage for the two columns grows roughly 2.7×.
- The startup label assumes the active config at first boot is the one that produced unlabelled
  rows (see §4.7). A deployment whose operator changed `EMBEDDINGS_PROVIDER` *and* skipped the
  re-index before upgrading was already broken; it will be labelled as matching and not warned.
- Mistral and Bedrock are verified against SDK fakes only; real-key checks are manual.

## 9. ADR amendment

ADR-017 is amended (Decision 2 superseded by a 1024-wide column with zero-padding; Decision 3
gains the per-chunk `embedding_model` stamp and the stale-documents warning) rather than adding a
new ADR, since the decision set is the same one evolving.

## 10. Approved change summary

Approved 2026-10-16 after one amendment round (the upgrade-warning question).

- **Goal** — admins switch embeddings to OpenAI, Mistral or Bedrock Titan and pick the model in the
  UI; the LLM key for that provider powers its embeddings; upgrading needs no admin action, and
  admins are told when, and only when, documents need re-indexing.
- **Rules** — curated catalogue per provider; keys from `AiConfig.apiKeys` (env fallback) without
  a restart; per-chunk `embedding_model` stamp; stale-document warning on the card and the
  Configuration nav; startup stamp for unlabelled rows.
- **Database** — both `embedding` columns widened to `vector(1024)` with zero-padding, nullable
  `embedding_model` added, HNSW rebuilt; `-- data-impact: preserved`.
- **Version** — MINOR 0.37.1 → 0.38.0, branch `enhance/admin-embedding-models/claude-rbrasier`
  from `main`.
- **Out of scope** — Cohere on Bedrock, OpenAI-compatible endpoints, free-text model ids,
  embeddings-only keys, automatic re-indexing.
