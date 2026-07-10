# Implementation Summary — Scaling Within the Current Stack, Group A (v1.55.0)

- **Version**: 1.55.0 (MINOR — new feature; no DB schema change, no migration,
  no new service)
- **Date**: 2026-07-03
- **Phase**: "Scaling Within the Current Stack (no new services)", **Group A —
  Pure code fixes** (the standalone first sub-phase). The phase doc stays in
  `to-be-implemented/` because Groups B–D are not yet built; it is a staged,
  multi-sub-phase roadmap and only moves when the last group lands.
- **Scope built**: the code-only, no-schema items of Group A. Everything here
  runs on the existing stack (Node, single Postgres, MinIO) and is independently
  shippable.

## What was built

### Item 1 — Message pagination + bounded per-turn read (wall #1)

- Added two methods to `ISessionMessageRepository`:
  - `latestBySession(sessionId, limit)` — the newest `limit` messages, returned
    chronologically. Rejects a non-positive/non-integer limit with
    `VALIDATION_FAILED`.
  - `listSince(sessionId, afterCreatedAt)` — the chronological delta after a
    cursor (the primitive Group C's SSE replay will build on).
- Implemented both in `DrizzleSessionMessageRepository` as SQL-template
  statement builders (`buildLatestBySessionStatement`,
  `buildListSinceStatement`) executed via `db.execute`, matching the
  schedule-repository pattern so the generated SQL is unit-testable without a
  live DB.
- Stream route now bounds the model's context to the most recent
  `CONTEXT_WINDOW_MESSAGES = 20` messages **server-side** (mirroring the client's
  existing `slice(-20)`), so prompt size and read cost stay flat as history
  grows, and the transcript is no longer taken from a client-supplied input.
- The gate-fail path's second full-history re-read was replaced with a bounded
  `latestBySession(session.id, 20)`.

### Item 2 — Parallelised stream-route prologue + admin-settings cache (wall #4)

- The prologue's six serial awaits (org name → global instructions → uploads →
  upload config → user profile → RAG) are now a single `Promise.all`.
- New `createCachedAdminSettings` (`apps/web/src/lib/cached-admin-settings.ts`)
  fronts the near-static admin settings (org name, global instructions, upload
  config) with the existing `TtlCache` (`ADMIN_SETTINGS_CACHE_TTL_MS`, default
  30 s; 0 disables). Reuses the auth-cache pattern rather than inventing a second
  cache shape.

### Item 3 — Batch participant hydration (wall #6)

- Added `IUserRepository.findByIds(ids)` — one `IN` query
  (`buildFindByIdsStatement`); empty input short-circuits with no query.
- Rewired the `session.get` tRPC procedure from one `findById` per participant
  per poll to a single `findByIds`, preserving the exact `{ id, name }[]` output.

### Item 4 — Cached immutable flow-version snapshots (wall #4)

- New `CachedFlowVersionRepository` decorator caches `getById` **only for
  published (immutable) versions**; drafts and misses always hit the inner repo,
  so a still-mutable draft snapshot is never served stale. TTL via
  `FLOW_VERSION_CACHE_TTL_MS` (default 300 s). Removes a repeated version-row
  read + snapshot JSON parse from every turn/poll that renders a pinned version.

### Item 5 — LLM concurrency limiter + backoff (wall #5)

- New `packages/adapters/src/ai/llm-concurrency.ts`:
  - `ConcurrencyLimiter` — bounds concurrent in-flight provider calls per
    instance (non-positive limit = unlimited/disabled).
  - `withRetry` — retries only rate limits (429) and transient 5xx/network
    errors, with full-jitter exponential backoff, honouring a `Retry-After`
    header when present. Duck-typed error detection so it is not coupled to a
    specific AI-SDK error class.
  - `LlmCallGovernor` — composes the two (concurrency outside, retry inside).
- A single shared governor is wired in the web container
  (`LLM_MAX_CONCURRENCY` default 0 = off, `LLM_MAX_ATTEMPTS` default 4) and
  applied to the port's `generateObject` (`LanguageModelAdapter`, covering
  auto-nodes/evaluations) and the chat stream route's direct branch-choice
  `generateObject` call, so one budget spans both the port and the direct SDK
  path.

### Item 7 — Scheduler tuning + parallelism (wall #8)

- Batch size is now env-driven (`SCHEDULER_BATCH_SIZE`, default 50) and threaded
  into `FireDueSchedules` from the web tick endpoint.
- The API server can run several heartbeat workers (`SCHEDULER_WORKER_COUNT`,
  default 1); the existing `FOR UPDATE SKIP LOCKED` claim (ADR-019) keeps their
  batches disjoint, so N workers drain a backlog N× faster with no schema change.

## Deliberately deferred (still Group A, follow-up sub-phase)

- **Item 6 — Harden the MCP/skills path.** The MCP pre-pass code
  (`runMcpToolPrepass`) does not exist on this branch; the phase conditions this
  item on the skills/MCP refactor branch landing. Nothing to harden yet.
- **Item 8 — Stream uploads to storage.** Verified against all three upload
  routes (chat session upload, flow context-docs, node template): each buffers
  the file to run **synchronous text extraction** on the request path, then
  stores the same buffer. Streaming to storage alone therefore removes no memory
  spike while extraction still holds the whole buffer — and moving extraction off
  the request path is the phase's job-queue work (the new-infrastructure phase).
  So in this codebase Item 8 does not stand alone; deferred with the extraction
  half rather than shipped as a no-op.
- **Item 1 (remainder).** The deeper "single load per turn" — replacing
  `GetSession`'s unbounded history load on the turn path and threading the
  freshly-persisted rows as an explicit parameter into `applyAdvanceSideEffects`
  — is a turn-pipeline refactor left for a follow-up; the bounded reads and the
  server-side context window land the read-amplification win now.
- **Item 4 (remainder).** Splitting the poll payload into "definition" vs
  "state" is a tRPC + client change deferred; the snapshot cache already removes
  the repeated read/parse cost.

## Files created

- `packages/adapters/src/ai/llm-concurrency.ts` (+ `.test.ts`)
- `packages/adapters/src/repositories/cached-flow-version-repository.ts` (+ `.test.ts`)
- `packages/adapters/src/repositories/drizzle-session-message-repository.test.ts`
- `packages/adapters/src/repositories/drizzle-user-repository.test.ts`
- `apps/web/src/lib/cached-admin-settings.ts` (+ `.test.ts`)
- `tests/e2e/phase-scaling-current-stack-group-a.spec.ts`

## Files modified

- `packages/domain/src/ports/session-message-repository.ts` — `latestBySession`, `listSince`
- `packages/domain/src/ports/user-repository.ts` — `findByIds`
- `packages/adapters/src/repositories/drizzle-session-message-repository.ts` — statement builders + methods
- `packages/adapters/src/repositories/drizzle-user-repository.ts` — `findByIds` + builder
- `packages/adapters/src/repositories/index.ts` — export cached flow-version repo
- `packages/adapters/src/ai/index.ts` — export the governor
- `packages/adapters/src/ai/language-model-adapter.ts` — optional governor on `generateObject`
- `packages/application/src/use-cases/scheduling/fire-due-schedules.test.ts` — batch-size tests
- `apps/web/src/lib/env.ts` — `LLM_MAX_CONCURRENCY`, `LLM_MAX_ATTEMPTS`, `ADMIN_SETTINGS_CACHE_TTL_MS`, `FLOW_VERSION_CACHE_TTL_MS`, `SCHEDULER_BATCH_SIZE`
- `apps/web/src/lib/container.ts` — governor, admin-settings cache, cached flow-version repo, exposed on the container
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — parallel prologue, cached admin settings, server context window, governed branch call, bounded gate-fail read
- `apps/web/src/app/api/internal/scheduler/tick/route.ts` — env-driven batch size
- `apps/web/src/server/routers/session.ts` — batched participant hydration
- `apps/api/src/env.ts` — `SCHEDULER_WORKER_COUNT`
- `apps/api/src/container.ts` — `schedulerWorkers` array
- `apps/api/src/index.ts` — start/stop all workers
- `VERSION`, `package.json` — 1.54.0 → 1.55.0

## Migrations run

None. Group A is code-only — no DB schema change (hence MINOR).

## Tests

- **Unit**: message pagination + `findByIds` statement builders (rendered via
  `PgDialect`); `ConcurrencyLimiter` / `withRetry` / `isRetryableProviderError` /
  `LlmCallGovernor`; `CachedFlowVersionRepository` (published cached, draft/miss
  not cached); `createCachedAdminSettings` (parallel load, warm hit, ttl-0
  bypass); `FireDueSchedules` batch-size threading. Full monorepo `pnpm test`
  passes (all 6 packages).
- **E2E**: `tests/e2e/phase-scaling-current-stack-group-a.spec.ts` — warm-cache
  authenticated navigations stay consistent; the chat stream route still rejects
  an unauthenticated turn with 401 after the prologue was parallelised. Runs in
  CI where Postgres/MinIO are available.

## Known limitations

- **Single-instance caches.** The admin-settings and flow-version caches are
  in-process; a multi-instance deployment promotes them to a shared store, same
  as the v1.49.0 auth cache (the new-infrastructure phase). Published versions
  are immutable so cross-instance staleness is a non-issue for the flow-version
  cache; admin settings can be stale for up to their TTL after an edit.
- **Governor covers request initiation, not stream duration.** The concurrency
  slot bounds discrete/structured calls and the retry policy; a streamed call
  cannot be safely retried mid-flight, so streaming is governed at initiation
  only.
- **E2E not executed in the build sandbox** (Docker registry blocked, as in
  v1.49.0); the spec runs in CI on push.
