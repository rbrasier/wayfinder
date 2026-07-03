# Phase — Scaling With New Infrastructure

- **Status**: Awaiting review (`/doc-review`); implementation is gated on
  going multi-instance and/or picking the cloud platform
- **Date**: 2026-07-03
- **Target version**: staged; mostly infra/ops. Code slices ship as their own
  sub-phases and bump independently —
  - Redis adapters (shared auth cache, event-bus adapter 2): **MINOR**
  - Job queue + first migrated producers: **MINOR**
  - Dockerfiles + object-storage parametrisation: **MINOR**
  - Connection pooler and read replica: infra only, no code bump (the
    `DATABASE_LISTEN_URL` caveat in item 1 is part of the event-bus slice)
- **Depends on / relates to**:
  - [`scaling-current-stack.phase.md`](./scaling-current-stack.phase.md) —
    do that phase first; it delivers most of the headroom to ~500 concurrent
    users and none of it is blocked on infrastructure decisions.
  - `implemented/v1.49.0/scaling-p0-pool-and-auth-cache.md` — the env-driven
    pool and the in-process auth cache this phase promotes to shared services.
  - ADR-017 (embedding providers), ADR-019 (in-app scheduler, queue
    candidates), ADR-023 (email transport).

---

## Scope

Enhancements that improve concurrent-usage performance but **require standing
up a new service**: a connection pooler, Redis, a job-queue backend, a read
replica, and the cloud platform itself. Everything code-only lives in the
companion phase doc.

The trigger for this phase is **horizontal scale**: the moment more than one
app instance runs, three in-process mechanisms must be promoted to shared
services (auth cache → Redis, event bus → Redis, background work → queue),
and the DB connection budget must be managed by a pooler rather than raw
Postgres. Until then, single-instance deployments need nothing here.

Each item below is implemented as its own sub-phase; when an item lands, its
implementation summary goes to `implemented/v<version>/` and this doc stays
here until the last code slice lands (the former roadmap's convention).

---

## The enhancements

1. **Connection pooler in front of Postgres** (PgBouncer / RDS Proxy /
   managed equivalent, transaction mode). This is what actually makes
   horizontal scaling safe — without it, more instances just exhaust
   `max_connections` (default 100). The app side is already prepared: the
   per-instance pool is env-driven (`DATABASE_POOL_MAX`, delivered v1.49.0),
   and the sizing rule (`pool × instances < max_connections`, ~15–20 per
   instance behind the pooler for ~500 concurrent) lives in the companion phase doc's capacity model. Ops work, not code — with one code caveat: the
   `LISTEN/NOTIFY` event-bus adapter needs one session-mode connection, so
   it must take a direct DB URL (`DATABASE_LISTEN_URL`, defaulting to
   `DATABASE_URL`) while the app pool goes through the pooler.
2. **Redis — the three promotions.** One managed Redis unlocks three things
   at once, all behind seams that already exist:
   - **Shared auth cache**: the v1.49.0 in-process `TtlCache` fronting
     session + permission resolution is single-instance correct; promote it
     to Redis so invalidation (logout, role change) is honoured across
     instances within TTL. The cache sits behind a clean seam precisely to
     make this swap local.
   - **Event-bus adapter 2**: Redis pub/sub drops in behind the
     `ISessionEventBus` port (companion phase doc, group C), replacing the
     per-instance Postgres LISTEN connection and scaling fan-out
     independently of the database. No client or event-vocabulary change.
   - **Queue backend** for item 3.
3. **A real job queue for fire-and-forget work** (companion phase doc, wall #7).
   Document generation, title generation, embedding/indexing, extraction,
   and email currently run detached inside the web process — a deploy or
   crash mid-generation silently loses them. ADR-019 sanctions **BullMQ**
   (Redis) or **pg-boss** (Postgres-only). Decision rule: since Redis is
   being added anyway (item 2), **BullMQ** is the default; **pg-boss is the
   escape hatch** if a deployment must avoid Redis entirely (air-gap — see
   the deployment options below), at the cost of keeping queue load on the
   primary database. First migrated producers: document generation and
   step-advance side effects (doc-gen, auto-node dispatch, initial-message
   generation) — they hold LLM calls open inside a streaming HTTP response
   today. Upload text extraction moves here too (companion phase doc, item 8).
4. **Read replica.** Route analytics/reporting and vector-heavy reads to a
   replica to protect the primary's write throughput. Driven by measured
   need (load tests, production metrics), not pre-emptively.
5. **Dockerfiles + service topology** (none exist today). Two containers:
   `apps/web`, and `apps/api` as a **separate always-on service** — never
   serverless, the scheduler is a long-lived polling loop. The load
   balancer's idle timeout must exceed turn length (~300 s) for both the
   chat stream and the SSE fan-out.
6. **Object storage parametrisation.** `MinioStorageAdapter` already speaks
   S3 — parametrise endpoint/region/credentials for native S3. Azure Blob
   needs a small new `IObjectStorage` adapter, or keep the S3 API via a
   MinIO gateway.

---

## AWS / Azure mapping

The hexagonal layout makes deployment mostly adapter selection + infra
mapping. The code-prerequisite column is what this repo must produce;
everything else is ops.

| Concern | Today | AWS | Azure | Code prerequisite |
| --- | --- | --- | --- | --- |
| Web (`apps/web`) | Node process | ECS Fargate (or App Runner) behind ALB | App Service / Container Apps | Dockerfile (item 5); LB idle timeout ≥ turn length (~300 s) for SSE + chat stream |
| Worker (`apps/api`) | Node process | Separate always-on ECS service | Separate Container App | Already isolated — keep off serverless |
| Postgres + pgvector | Docker compose | RDS/Aurora (pgvector) + RDS Proxy | Flexible Server (pgvector) + PgBouncer | None — pool env-driven; pooler is item 1 |
| Object storage | MinIO | S3 | Blob (or S3-compatible gateway) | Item 6 |
| Cache / bus / queue | in-process `TtlCache` only | ElastiCache Redis | Azure Cache for Redis | Item 2 |
| Email | SMTP/M365 | SES or keep M365 | ACS or keep M365 | None — runtime-configured (ADR-023) |
| Secrets (incl. MCP `credentialRef`) | env vars | Secrets Manager → env | Key Vault → env | None — `credentialRef` resolves env var names |
| Observability | Langfuse + Pino | CloudWatch + Langfuse (OTel wired) | App Insights + Langfuse | None |
| Embeddings (local mode) | in-process transformer | fine on Fargate (CPU) or switch provider | same | Already provider-switchable (ADR-017) |

On AWS, note that Bedrock is already a supported LLM provider — it collapses
the provider secret story to IAM. Optional, not a prerequisite.

---

## Deployment shape options

| Option | Best when | Cost to adopt | Notes |
| --- | --- | --- | --- |
| **Managed PaaS + managed data (recommended)** | Minimal ops; no air-gap requirement | Low | Web on Vercel/Railway/Render; managed Postgres with built-in pooler; managed Redis; S3-compatible storage. Delivers the pooler and autoscaling with least burden. |
| **Containers / Kubernetes (EKS/AKS)** | Self-hosting or air-gap required | High | Needs Dockerfiles, PgBouncer deployment, replica config, ingress/LB. |
| **Single large VM (vertical)** | Very early, cost-sensitive, strict on-prem | Low–Med | No fault tolerance, hard ceiling; stopgap only. |

No Kubernetes requirement at this scale — container services + managed data
is the default. The existing PKI/client-cert auth and self-hostable MinIO
signals suggest some deployments may need air-gap; if that hardens, the
Kubernetes row is the path and pg-boss beats BullMQ (avoids a mandatory
Redis dependency). The adapters keep both open.

**Statelessness holds** (audited v1.49.0) *provided* the three promotions in
item 2/3 happen when instance count > 1. The SSE fan-out design is
multi-instance correct from day one because publishes traverse the event
bus, never process memory.

---

## Acceptance criteria

- Both apps run as containers behind a pooler with N=2 replicas.
- Logout on instance 1 is honoured on instance 2 within cache TTL (shared
  auth cache).
- A mid-generation deploy re-runs document generation from the queue instead
  of losing it.
- Load tests (companion phase doc, item 16) gate each item's exit; `./validate.sh`
  passes; versioning rules honoured per implementing phase.

---

## Risks and open questions

- **Platform streaming limits**: confirm the chosen host's proxy/LB
  streaming behaviour (idle timeouts, buffering) for the chat stream and SSE
  once the platform is picked.
- **Air-gap signals**: if PKI/on-prem requirements harden, revisit the
  BullMQ-vs-pg-boss default (item 3) and the Kubernetes row before
  committing to Redis-dependent choices.
- **Sequencing**: nothing here blocks the companion phase doc's groups A–D; the
  `ISessionEventBus` port and cache seams are designed so each promotion is
  a local adapter swap when the service arrives.

---

## Provenance

- Former `docs/development/to-be-implemented/scaling-to-concurrent-load.phase.md`
  (P1/P2 infra items and the deployment recommendation) and
  `concurrency-collaboration-and-cloud-readiness.phase.md` (§5 cloud
  readiness).
- Related ADRs: ADR-017 (embedding providers), ADR-019 (in-app scheduler,
  queue candidates), ADR-023 (email transport).
