# Phase — AWS Lambda Deployment Target

- **Status**: Awaiting review (`/doc-review`); implementation is gated on that review
- **Date**: 2026-09-02
- **Target version**: 0.33.0 — **MINOR** (new capability, no schema impact)
- **Base branch**: `main` (new feature — see **Release Branching** in [`CLAUDE.md`](../../../CLAUDE.md))
- **Depends on / relates to**:
  - ADR-046 (container image distribution) — the published image stays the
    reference artefact; this phase does not replace it
  - ADR-019 (in-app job scheduler) — the worker tick shape is what makes this
    possible at all
  - ADR-017 (configurable embedding providers) — the hosted-provider setting is
    a hard prerequisite here
  - ADR-047 (migrations as an explicit command) — migrations are already a
    discrete invocation, so they port unchanged
  - [`scaling-new-infrastructure.phase.md`](./scaling-new-infrastructure.phase.md) —
    overlaps on the shared-service question and contains two statements this
    phase must correct (§10)

---

## 1. Goal

Give operators an AWS deployment option with **no always-on web or worker
compute**, for pilots and low-duty-cycle tenants where a 24/7 Fargate pair is
poor value.

Two constraints define the phase:

1. **No restructuring.** The framework's existing seams already support this.
   Nothing in `packages/*` changes, and exactly one behaviour-neutral extraction
   happens in `apps/api` (§5).
2. **No effect on other providers.** The Docker Compose, ECS Fargate, Azure
   Container Apps and Railway paths must be byte-for-byte unaffected. This is
   enforced by placement (§4.1), not by discipline.

The container path remains the reference deployment. Lambda is an additional
target and never becomes the canonical one.

---

## 2. Scope

**In scope** — a `deploy/lambda/` package containing Lambda entrypoints and an
infrastructure stack, an installation guide, an update runbook, and the one
`apps/api` extraction that lets a handler import the container without starting
a server.

**Out of scope:**

- Replacing the Postgres `LISTEN`/`NOTIFY` session event bus with a managed push
  service. Named as a possible follow-on in §7.1; not planned here.
- Promoting `TtlCache` and `IRateLimiter` to Redis — that work belongs to
  [`scaling-new-infrastructure.phase.md`](./scaling-new-infrastructure.phase.md).
- Local / air-gapped embeddings on Lambda (§7.5).
- Azure Functions, GCP Cloud Run Functions, and multi-region deployment.

---

## 3. Why this needs no restructuring

The claim in §1 rests on seams that already exist. Each is load-bearing for this
phase, and each should be re-verified during `/doc-review`:

| Seam | Where | Why it matters |
|---|---|---|
| Entrypoint-per-runtime is already the pattern | `docker-entrypoint.sh` selects `web` / `api` / `migrate` from one image | A Lambda deployment is a fourth set of entrypoints, not a new architecture |
| The workers are already tick functions | `packages/adapters/src/scheduling/scheduler-worker.ts:40` — `start()` is `setInterval(() => tick())` | An EventBridge-driven handler calls `tick()` once and returns. **No worker code changes at all** |
| Concurrent ticks are already safe | The claim paths use `FOR UPDATE SKIP LOCKED` (ADR-019, ADR-033 §6) | Overlapping invocations cannot double-fire a schedule or a batch |
| Scheduling already crosses an HTTP boundary | `apps/web/src/app/api/internal/scheduler/tick/route.ts`, secret-protected via `SCHEDULER_TICK_SECRET` | EventBridge Scheduler can drive it directly; the `api` process loses its scheduling role entirely |
| Migrations are already discrete | ADR-047; `apps/api/src/cli/migrate.ts` | A one-shot handler, no start-path coupling |
| Storage already speaks S3 | `packages/adapters/src/storage/minio-storage.ts` with path-style and region flags | Native S3 needs configuration, not code |
| Embeddings are already swappable | ADR-017 dispatching adapter | `EMBEDDINGS_PROVIDER=openai` drops `onnxruntime-node` from the deployment |
| Express is already a pure builder | `apps/api/src/app.ts:10` — `buildApp(container)` | Wraps in an adapter with no changes to route code |
| The web container is a lazy singleton | `apps/web/src/lib/container.ts:785` — `getContainer()` memoises on a global | Correct behaviour across warm invocations with no change |

---

## 4. What is built

### 4.1 Placement — `deploy/lambda/`, outside the pnpm workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `mocks`. A package under
`apps/` would therefore be pulled into the workspace automatically, with three
consequences for **every other provider**:

1. **The Docker build would break.** The `Dockerfile` copies each workspace
   manifest by name and then runs `pnpm install --frozen-lockfile`. A new
   workspace member present in the lockfile but absent from that COPY list fails
   the install.
2. **The published image would grow.** The Dockerfile deliberately does not run
   `pnpm prune --prod` (it says why). CDK and the Lambda adapters would ship
   inside the image pushed to Azure Container Apps and ECS.
3. **`validate.sh` and turbo would sweep it** — `find packages/*/src apps/*/src`
   at `validate.sh:288`, `:355` and `:372`.

`deploy/lambda/` sits outside all three globs. The blast radius on existing
deployments is then **zero by construction**, not by care.

The accepted cost: it gets no turbo caching and no `validate.sh` coverage for
free. §12 makes wiring its own checks into CI a required deliverable, because an
out-of-workspace package that nothing typechecks is exactly how handlers drift
away from `container.ts`.

### 4.2 Contents

```
deploy/lambda/
  package.json            # own dependencies, own lockfile; not a workspace member
  handlers/
    web.ts                # Next.js, via OpenNext
    api.ts                # buildApp(container), via an Express→Lambda adapter
    tick-scheduler.ts     # SchedulerWorker.tick()
    tick-extraction.ts    # ExtractionWorker.tick()
    tick-retention.ts     # RetentionWorker.tick()
    migrate.ts            # the ADR-047 migrate command, one-shot
  infra/                  # CDK stack: functions, EventBridge rules, RDS Proxy,
                          # S3, Function URL, CloudFront, secrets wiring
  README.md               # points at docs/guides/setup-aws-lambda.md
```

Every handler imports the existing containers and use-cases. None of them
reimplements framework behaviour; a handler that needs to do so is a signal the
seam is missing and should be raised rather than worked around.

**Tooling choice is not settled by this doc.** OpenNext (`@opennextjs/aws`) is
the presumed route for the web handler specifically because it builds from a
standard `next build` and therefore requires no change to `next.config.ts` — the
Lambda Web Adapter alternative needs `output: "standalone"`, which would change
the web build output for every provider and must not be adopted casually. Per
the code-writing rules, whichever packages are chosen must have their exact API
verified in `node_modules` at build time rather than assumed.

---

## 5. The one change inside the existing tree

`apps/api/src/index.ts` calls `app.listen()` at line 18 and starts three worker
loops **as import side effects**. A Lambda handler importing the api package
would boot an HTTP server and three pollers inside the execution environment.

**The change is an extraction, not a move:**

- Move the `listen` call and the worker startup into an exported
  `startWorkers(container)` / server bootstrap in a new `apps/api/src/workers.ts`
- `index.ts` remains the process entrypoint and immediately calls it
- `package.json`'s `start` script, `esbuild.config.mjs`'s `entryPoints`, and
  `docker-entrypoint.sh` are **all unchanged**

Runtime behaviour on ECS, Azure, EC2 and Railway is identical before and after.
`/doc-review` should treat any proposal that changes the `api` start path as out
of bounds for this phase.

---

## 6. Deployment topology — hybrid

| Wayfinder piece | Lambda deployment |
|---|---|
| `web` (Next.js) | Lambda behind a Function URL in `RESPONSE_STREAM` mode, fronted by CloudFront |
| Scheduler tick | Lambda on an EventBridge rule, or EventBridge Scheduler POSTing the existing tick endpoint |
| Extraction tick | Lambda on EventBridge, plus on-demand invocation at upload (§7.4) |
| Retention sweep | Lambda on an EventBridge rule |
| `migrate` | One-shot Lambda invoked by the deploy pipeline before the new version serves traffic |
| **SSE session events** | **Small always-on Fargate or App Runner service** (§7.1) |
| n8n webhook (`/v1/webhooks`) | Lambda via the api handler — the one route with outside ingress |
| Postgres + pgvector | RDS PostgreSQL 16, behind RDS Proxy, with `DATABASE_LISTEN_URL` on the direct endpoint |
| Object storage | S3, `MINIO_PATH_STYLE=false` and `MINIO_REGION` set |
| Embeddings | Hosted provider only (§7.5) |

**API Gateway is not usable** for the web or chat paths: it cannot stream and
caps at 30s, while a turn runs to roughly 300s. Function URLs with response
streaming are the only viable front door.

---

## 7. Constraints this target accepts

These are not defects to fix in this phase. They are the honest cost of the
topology, and every one of them must appear in the installation guide.

### 7.1 The SSE stream stays on always-on compute

`apps/web/src/app/api/sessions/[sessionId]/events/route.ts` holds a long-lived
connection backed by a Postgres `LISTEN` subscription. On Lambda, **every open
chat tab pins a billed concurrent execution** for up to the 15-minute ceiling,
after which it drops regardless of client state; each warm instance also holds
its own `LISTEN` connection.

The hybrid routes that one path to a small always-on service via CloudFront.
Making it fully serverless means replacing the bus adapter (AppSync Events, IoT
Core, or API Gateway WebSockets) as a Level-2 override plus a change to the
client `EventSource` in `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`.
That is a separate phase and is explicitly not planned here.

### 7.2 Rate limiting becomes per-instance

`InMemoryRateLimiter` is process-scoped
(`packages/adapters/src/rate-limit/in-memory-rate-limiter.ts:21`). Across Lambda
instances the effective ceiling is `configured limit × concurrent instances`.
The guide must state this plainly. Budget enforcement (ADR-027) is unaffected
because it is DB-backed.

The same applies to the LLM concurrency semaphore, which stops bounding total
in-flight model calls.

### 7.3 Cache hit rates fall

The auth and permission `TtlCache` layers barely warm across cold instances,
raising per-request DB reads. This is the same pressure
`scaling-new-infrastructure.phase.md` addresses with Redis; Lambda encounters it
earlier. Sizing guidance in the guide must account for it.

### 7.4 Extraction tick cadence

`ExtractionWorker`'s default is a 5s tick, chosen because an operator is
watching a progress bar. EventBridge's floor is 60s, so the `x of y` counter
visibly slows. Mitigation: invoke the extraction handler on upload as well as on
the schedule. Step Functions and SQS are alternatives the guide may mention but
this phase does not build.

### 7.5 Hosted embeddings only

Lambda requires `EMBEDDINGS_PROVIDER=openai` (or a Bedrock embeddings adapter).
This drops `onnxruntime-node` and its model from the artefact, which keeps cold
starts sane and allows a zip-based deployment. **Air-gapped and local-model
deployments stay on the container path** — the guide must say so directly rather
than leaving operators to discover it.

### 7.6 Connection budget

Lambda concurrency multiplied by pool size will exhaust RDS without a proxy. The
`LISTEN` connection needs session mode, which RDS Proxy does not provide — hence
`DATABASE_LISTEN_URL` against the direct endpoint, exactly as
`packages/adapters/src/messaging/create-session-event-bus.ts` anticipates and
`setup-aws.md` already documents.

---

## 8. Installation guide — `docs/guides/setup-aws-lambda.md`

A new guide, structured to mirror [`setup-aws.md`](../../guides/setup-aws.md) so
an operator moving between them recognises the shape. It must cover:

1. **What Wayfinder actually needs** — the same four requirements, with the
   Lambda-specific note that one always-on service remains for SSE
2. **Mapping the pieces to AWS services** — the §6 table
3. **Prerequisites** — RDS with pgvector, the S3 bucket and its IAM user (the
   storage adapter signs with a static key pair, not the execution role), and
   Secrets Manager
4. **Deploying the stack** — CDK bootstrap and deploy, with the migrate
   invocation ordered *before* the web function serves traffic
5. **Environment variable mapping** — including `DATABASE_LISTEN_URL`,
   `EMBEDDINGS_PROVIDER`, `SCHEDULER_TICK_SECRET`, `MINIO_PATH_STYLE=false`
6. **First login and verification** — the `/setup` flow, mirroring `setup-aws.md` §9–10
7. **Constraints and cost shape** — §7 in operator language, especially the SSE
   concurrency bill and the extraction cadence
8. **Troubleshooting** — a table in the same format, seeded with: streams cut at
   15 minutes, `LISTEN` failures behind RDS Proxy, connection exhaustion, cold-start
   latency, and the local-embeddings misconfiguration

`setup-aws.md` §Alternatives gains a cross-link. Its own content does not change.

## 9. Update path — `docs/guides/upgrading.md`

`upgrading.md` currently documents Docker Compose and "AWS ECS and Azure
Container Apps". It gains a **Lambda** section covering:

- Migrations run as the one-shot handler **before** the new web version serves,
  preserving the invariant that the app never starts against an unmigrated schema
- Redeploying the stack, and version pinning for the artefact
- Rolling back: because there is no schema change in this phase, rollback is a
  stack rollback — but the guide must state the general rule that a version
  carrying a migration follows the existing rollback guidance, not this one
- Zero-downtime caveats: in-flight SSE connections on the always-on service drop
  on its redeploy

---

## 10. Docs this phase must correct

[`scaling-new-infrastructure.phase.md`](./scaling-new-infrastructure.phase.md)
states at `:104` that `apps/api` runs as "a **separate always-on service** —
never serverless, the scheduler is a long-lived polling loop", and repeats it at
`:135` ("keep off serverless").

That was accurate when written. The tick-per-invoke shape makes it obsolete: the
polling loop is a property of `index.ts`, not of the worker. Both lines must be
revised to point here rather than left contradicting a shipped capability.

---

## 11. Database changes

**None.** No schema change, no migration, and therefore no `-- data-impact:`
declaration. This is also why the rollback story in §9 is simple — a point worth
stating rather than leaving implicit.

---

## 12. Implementation order

1. Extract `startWorkers` from `apps/api/src/index.ts` (§5); prove the container
   start path is unchanged before anything else is built
2. Scaffold `deploy/lambda/` with its own manifest and lockfile; confirm it is
   invisible to `pnpm install`, turbo and `validate.sh` at the repo root
3. Verify the chosen Lambda tooling APIs in `node_modules` — do not rely on
   assumed package shapes
4. Tick handlers first (scheduler, retention, extraction): smallest surface,
   and they prove the container imports cleanly under Lambda
5. The migrate handler, then the api handler, then the web handler — the web
   handler last because it is the one with real packaging risk
6. CDK stack, including RDS Proxy and the `DATABASE_LISTEN_URL` split
7. A CI job for `deploy/lambda` (typecheck, lint, tests). **Required, not
   optional** — without it nothing catches handler drift against `container.ts`
8. `setup-aws-lambda.md`, the `upgrading.md` section, the `setup-aws.md`
   cross-link, and the §10 corrections
9. `./validate.sh` and fix all failures

---

## 13. Acceptance criteria

- [ ] `./validate.sh` passes
- [ ] The container image builds unchanged, and `docker compose -f docker-compose.prod.yml up -d` brings up web, api and migrate exactly as before
- [ ] `git diff` shows no change to `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.prod.yml`, `pnpm-workspace.yaml`, `turbo.json`, `next.config.ts` or any file under `packages/`
- [ ] `apps/api` starts identically: server listening, three workers running, same log lines
- [ ] A deployed stack completes the first-run `/setup` flow, runs a chat turn with streaming, fires a scheduled session, and completes an extraction batch
- [ ] Migrations apply via the one-shot handler, and the web function refuses to serve against an unmigrated schema
- [ ] The CI job for `deploy/lambda` fails when a handler is broken against a `container.ts` change
- [ ] `setup-aws-lambda.md` and the `upgrading.md` Lambda section exist and state every §7 constraint
- [ ] `scaling-new-infrastructure.phase.md:104` and `:135` are corrected

---

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| **SSE economics surprise operators** | The guide states the concurrency cost explicitly; the hybrid keeps it on always-on compute where it is predictable |
| **Silent drift** — `deploy/lambda` is outside the workspace, so nothing typechecks it against `container.ts` | The CI job at step 7 is a required deliverable, not a nice-to-have |
| **Connection exhaustion under load** — fails at load, not at deploy | RDS Proxy plus the `DATABASE_LISTEN_URL` split, and a load check before sign-off |
| **`pdf-parse` packaging** — it reads its own package files at runtime and is `external` in both existing builds | Prove it resolves inside the Lambda artefact during step 5, not after deployment |
| **Doc rot** — a fourth provider guide is a fourth thing to keep true | The guide states the container path is the tested reference; Lambda is additive |

**Open questions for `/doc-review`:**

1. Is the always-on SSE service acceptable, or does the hybrid's remaining
   always-on component undermine the reason for wanting Lambda at all?
2. Should the extraction handler's on-demand invocation be in this phase, or is
   a 60s cadence acceptable for a first cut?
3. Does `deploy/lambda` warrant an ADR recording the second-topology decision?
   This phase deliberately ships without one; that choice should be tested.

---

## 15. Provenance

Generated by `/new-feature` on 2026-09-02 from an investigation of the
deployment path, following the approved change summary. Decisions taken at
planning time: hybrid topology, `deploy/lambda/` placement, phase doc without a
PRD or ADR, hosted embeddings only, and installation plus update guides matching
the other providers.
