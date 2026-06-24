# Phase — Scaling to Concurrent Load (~500 concurrent users)

- **Status**: In progress — **P0 code delivered in v1.49.0** (env-driven pool +
  request-path session/permission cache); P1/P2 remain to-be-implemented and will
  land as their own ADRs/phases. This roadmap stays here until all tiers ship.
- **Date**: 2026-06-22
- **Target version**: staged; each sub-phase bumps independently (P0 likely
  MINOR — env-driven pool + cache adapter, no schema change; later phases
  MINOR/MAJOR as noted per item)
- **Target load**: ~500 concurrent active users (≈5000 registered accounts at
  ~10% concurrency), each running document-producing AI workflows
- **Depends on / Relates to**: ADR-007 (session-scoped LangGraph), ADR-019
  (in-app job scheduler), ADR-026 (usage governance enforcement)

## Scope

This document maps where Wayfinder's current design runs out of headroom on the
path to ~500 concurrent users, and sequences the changes that get it there. It
is a **staged phase**: the P0/P1/P2 items below are built and split into their
own ADRs incrementally rather than landed all at once — P0 first, behind load
tests, with later tiers driven by measured need.

**In scope**: connection limits, request-path caching, LLM concurrency,
background work, data growth, horizontal scaling, deployment shape.

**Out of scope**: multi-region/active-active, multi-tenant data sharding,
sub-second scheduling. These are not needed at this scale and add cost.

## What "5000 users" means here

We size for **~500 concurrent active users** (the load profile the team is
targeting), not 5000 simultaneous. 5000 *registered* accounts is not itself a
scaling problem; 5000 *concurrent* AI sessions would be a much larger effort
(read replicas, provider-side rate budgeting, aggressive autoscaling) and is
explicitly deferred.

## Current architecture (baseline)

A pnpm/Turbo monorepo:

- `apps/web` — Next.js 15 (App Router), tRPC v11, streaming chat via the Vercel
  AI SDK. Serves the UI and most application APIs.
- `apps/api` — Express service: `/health`, webhooks, and the scheduler tick
  loop. Optionally runs the `SchedulerWorker`.
- `packages/{domain,application,adapters,shared}` — hexagonal layering; adapters
  are swappable behind domain ports (Result pattern at every boundary).

Backing services: a **single Postgres** (Drizzle ORM, pgvector), MinIO/S3 object
storage, and a **Postgres-polling scheduler**. There is **no Redis, no caching
layer, and no horizontal-scaling or container/orchestration config** in the repo
today.

## Where it breaks at ~500 concurrent

| # | Wall | Evidence | Effect at ~500 concurrent |
| - | --- | --- | --- |
| 1 | DB pool hardcoded to `max: 10` | `packages/adapters/src/db/client.ts` (`postgres(databaseUrl, { max: 10 })`) | ~10 in-flight queries per process; everything else queues. **The single biggest limiter.** |
| 2 | Per-request session lookup, no cache | `packages/adapters/src/auth/session-resolver.ts` (`resolveSession`), called from `middleware.ts`, `trpc.ts`, and the stream route | Every request spends ≥1 connection on an auth query, multiplying pool pressure from wall #1. |
| 3 | Per-request permission resolution | tRPC `createTrpcContext` → `getEffectivePermissions()` (role/permission lookup) | Additional DB round-trips on every authenticated call. |
| 4 | Single web/API process, no LB/replicas | No Dockerfile or orchestration config in repo | One Node event loop; no horizontal headroom; a restart drops all in-flight work. |
| 5 | Unbounded LLM concurrency | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` issues ~2 model calls per turn | 500 concurrent turns ⇒ up to ~1000 simultaneous provider calls — provider rate limits (TPM/RPM) and per-stream memory both bite. |
| 6 | Single scheduler worker, batch 50 / 60s tick | `packages/adapters/src/scheduling/scheduler-worker.ts`, `packages/application/src/use-cases/scheduling/fire-due-schedules.ts` | If many schedules come due together, they drain at ≤50 per tick (~50/min), creating a backlog. |
| 7 | Unbounded-growth tables, no archival | `ai_usage_events`, `app_session_messages`, `core_audit_log`, `app_error_log`, `app_notification_log` | Index/table bloat over months; slower hot-path queries; rising storage cost. |
| 8 | In-memory upload buffering | `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts` (`Buffer.from(await file.arrayBuffer())`, then sync extraction) | Concurrent large uploads spike process memory and block the request path during extraction. |

### What already helps (leverage, don't rebuild)

- **Hexagonal architecture** — swapping a Postgres adapter for a pooled/replica
  one, or adding a Redis cache adapter, is a local change behind a port.
- **Hot-path indexes already exist**: `ai_usage_events(user_id, created_at)`
  (backs the budget check on every LLM call), `app_session_schedules(status,
  next_fire_at)` (backs the scheduler claim), plus session/message/approval
  indexes and a pgvector **HNSW** index on `kb_document_chunks.embedding`.
- **Durable poller built for multi-worker** — ADR-019 claims rows with
  `FOR UPDATE SKIP LOCKED`, so running N scheduler workers needs no schema
  change.
- **Prompt caching + shared compiled graphs** — ADR-007 caches the compiled
  LangGraph per `(flowId, flowVersionHash)` and uses Anthropic prompt caching,
  cutting per-turn cost ~90% on repeated flows.
- **Per-user spend caps** — ADR-026 already enforces budgets on the hot path,
  giving a cost circuit-breaker independent of request volume.

## Capacity model (back-of-envelope)

Per active chat turn the request path does roughly:

- 1 session lookup (wall #2) + 1 permission resolution (wall #3)
- 1 quota/budget check (`ai_usage_events` sum) before the LLM call (ADR-026)
- optional 1 RAG vector lookup (`kb_document_chunks`)
- ~2 model calls (main stream + optional branch choice)
- a handful of writes (message rows, usage event)

So a single turn touches **~4–6 short DB operations** plus 1–2 LLM calls that may
each run for seconds. The DB ops are fast; the LLM calls dominate wall-clock and
hold a streaming response open.

**Connection sizing.** With a 10-connection pool, even a few dozen users doing
overlapping turns will saturate it, because connections are held across the
quick DB ops *and* contend during streaming. Rule of thumb: size
`pool_per_instance × instance_count` to stay safely **below Postgres
`max_connections`** (default 100), reserving headroom for migrations, the
scheduler, and admin tooling. For ~500 concurrent across, say, 4 web instances,
a per-instance pool of ~15–20 **behind a connection pooler** (PgBouncer-style
transaction pooling) is a sane starting point — the pooler, not raw Postgres,
absorbs the fan-out. Validate with load tests (P2) rather than guessing.

**LLM throughput.** 500 concurrent turns × ~2 calls can exceed provider
per-minute token/request limits long before the DB does. This makes wall #5
(concurrency limiting + backoff) a first-class concern, not an afterthought —
prompt caching (ADR-007) reduces token volume but not request count.

## Roadmap

### P0 — Lift the obvious ceilings (low risk: config + caching)

1. ✅ **Make the DB pool size configurable.** *(Delivered v1.49.0.)* The
   hardcoded `max: 10` in `packages/adapters/src/db/client.ts` is now an
   env-driven `DATABASE_POOL_MAX` (default kept low for dev), wired in both
   app containers. The `pool × replicas < max_connections` constraint is
   documented at the call site and in both env schemas.
2. **Put a connection pooler in front of Postgres.** PgBouncer / RDS Proxy /
   Supabase pooler (transaction mode) so multiple app instances multiplex a
   bounded set of real Postgres connections. This is what actually makes
   horizontal scaling safe — without it, more instances just exhaust
   `max_connections`. *(Infra/ops — not code; out of the v1.49.0 build.)*
3. ✅ **Cache session + permission resolution on the request path.**
   *(Delivered v1.49.0.)* A short-TTL in-process cache (`TtlCache`) now fronts
   `resolveSession` and effective-permission resolution, removing 2 DB
   round-trips from the hottest path. Positive-only for sessions (a missing
   token is never negatively cached). TTL/size are env-driven
   (`AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES`); set TTL to 0 to disable.
   Correct for a single instance — promote to **Redis** the moment there is more
   than one instance so invalidation is shared (the cache lives behind a clean
   seam to make that swap local).
4. ✅ **Confirm/keep the app stateless.** *(Audited v1.49.0.)* The only
   load-bearing per-instance state is rebuildable cache (the ADR-007
   compiled-graph cache and the new auth caches) plus the lazily-built auth
   instance — all reconstructable on any instance. No cross-request session
   state is held in memory. See the v1.49.0 implementation summary for the full
   audit. Statelessness holds, so N replicas behind a load balancer is safe
   (pending the shared cache promotion in item 3 once >1 instance runs).

P0 alone — env-driven pool, a pooler, a session cache, and 2–4 stateless
replicas — should comfortably carry the ~500-concurrent target for the common
case.

### P1 — Concurrency and growth control

5. **Bound and harden LLM calls.** Add a per-instance concurrency limiter and
   retry-with-backoff around the provider calls in the stream route
   (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`); honour provider
   rate-limit headers. Keep prompt caching (ADR-007).
6. **Introduce a real job queue for fire-and-forget work.** Embedding/indexing,
   document extraction, and email currently run inline/fire-and-forget with no
   retry or dead-letter. ADR-019 already names **BullMQ** and **pg-boss** as the
   sanctioned future path — pick one here. pg-boss keeps everything in Postgres
   (no new infra); BullMQ needs Redis but scales harder. Recommendation:
   **pg-boss** unless Redis is already being added for the session cache, in
   which case **BullMQ**.
7. **Tune and parallelise the scheduler.** Make batch size and tick interval
   configurable, and run multiple `SchedulerWorker` instances — the data model
   already supports it via `FOR UPDATE SKIP LOCKED` (ADR-019). No schema change.
8. **Stream uploads instead of buffering.** Stream straight to MinIO/S3 and move
   text extraction into the job queue (item 6), removing the memory spike and
   request-path block in the uploads route.

### P2 — Durability and cost over time

9. **Retention/archival for unbounded tables.** Define archival or partitioning
   for `ai_usage_events`, `app_session_messages`, `core_audit_log`,
   `app_error_log`, and `app_notification_log`; add cursor pagination to message
   history reads so a long session never loads its full history into memory.
10. **Read replica.** Route analytics/reporting and vector-heavy reads to a
    replica to protect the primary's write throughput.
11. **Load testing + SLOs.** There are no load/perf tests today (only Vitest +
    Playwright). Add a k6/Artillery suite, define target SLOs (e.g. p95 turn
    latency, error rate at 500 concurrent), and run it **before and after each
    phase** so sizing decisions are measured, not guessed.

## Deployment recommendation (currently undecided)

The repo has no Dockerfile or orchestration config, so deployment shape is an
open decision. Three options, with a clear default:

| Option | Best when | Cost to adopt | Notes |
| --- | --- | --- | --- |
| **Managed PaaS + managed data (recommended)** | Team wants minimal ops; no air-gap requirement | Low | Web on Vercel/Railway/Render; managed Postgres **with a built-in pooler**; managed Redis; S3-compatible storage. Autoscaling and pooling largely handled for you. |
| **Containers / Kubernetes** | Self-hosting or air-gap is required; want full control | High | Needs new **Dockerfiles**, a **PgBouncer** deployment, replica config, and an ingress/LB. None exist yet. |
| **Single large VM (vertical)** | Very early, cost-sensitive, or strict on-prem | Low–Med | Simplest, but no fault tolerance and a hard ceiling; only a stopgap at this scale. |

**Recommended:** managed PaaS + managed data services. It delivers P0's two
hardest pieces — a connection pooler and horizontal autoscaling — with the least
operational burden, and Redis-as-a-service makes the P0 session cache and a P1
BullMQ queue cheap to add.

**Important operational note:** `apps/api` (scheduler + webhooks) must run as a
**separate always-on service**, not as serverless functions — the scheduler is a
long-lived polling loop. On a serverless web host, deploy `apps/api` as a
dedicated worker/service alongside it.

**Watch for on-prem signals.** Configurable PKI/client-certificate auth and the
self-hostable MinIO dependency suggest some deployments may need to be
air-gapped. If that becomes a hard requirement, the containers/Kubernetes row
above is the path, and pg-boss (item 6) becomes preferable to BullMQ to avoid a
mandatory Redis dependency.

## Sequenced next steps

1. **P0 as one ADR + `/build` phase** — env-driven pool, pooler guidance,
   session/permission cache, statelessness audit. Highest value, lowest risk.
2. **Stand up load testing (item 11) early**, even partially, so P0 sizing is
   measured.
3. **P1 items as individual ADRs** — LLM concurrency, job-queue choice
   (BullMQ vs pg-boss), scheduler parallelism, streaming uploads.
4. **P2 as needed**, driven by what the load tests and production metrics
   (Langfuse/OpenTelemetry are already wired) actually show.

Run `/doc-review` on this roadmap before any phase is picked up by `/build`.
