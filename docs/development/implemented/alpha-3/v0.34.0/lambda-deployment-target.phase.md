# Phase — AWS Lambda Deployment Target

- **Status**: Reviewed (`/doc-review`, 2026-09-05) — revised against that review; ready to build
- **Date**: 2026-09-02 (revised 2026-09-05)
- **Target version**: 0.34.0 — **MINOR** (new capability, no schema impact)
- **Base branch**: `main` (new feature — see **Release Branching** in [`CLAUDE.md`](../../../CLAUDE.md))
- **Depends on / relates to**:
  - **ADR-056 (Lambda is a second deployment topology)** — written alongside this
    phase; it records why the topology exists and what it promises not to become
  - ADR-046 (container image distribution) — the published image stays the
    reference artefact; this phase does not replace it
  - ADR-019 (in-app job scheduler) — the worker tick shape is what makes this
    possible at all
  - ADR-017 (configurable embedding providers) — the hosted-provider setting is a
    hard prerequisite, and ADR-056 §4 refines its Decision 1 (§7.5 below)
  - ADR-047 (migrations as an explicit command) — migrations are already a
    discrete invocation, so they port unchanged
  - the *Scaling With New Infrastructure* phase doc —
    overlaps on the shared-service question and contains two statements this
    phase must correct (§10)

---

## 1. Goal

Give operators an AWS deployment option with **no always-on web or worker
compute**, for pilots and low-duty-cycle tenants where a 24/7 Fargate pair is
poor value.

Two constraints define the phase:

1. **No restructuring.** The framework's existing seams already support this. No
   new ports, no new adapters, no schema change, and no change to how any
   existing process starts. Three small, enumerated changes happen inside the
   existing tree (§5); two of them fix gaps that are latent today.
2. **No effect on other providers.** The Docker Compose, ECS Fargate, Azure
   Container Apps and Railway paths must behave identically before and after.
   This is enforced by placement (§4.1) and by CI (§13), not by discipline.

The container path remains the reference deployment. Lambda is an additional
target and never becomes the canonical one (ADR-056 §1).

> **Revised from the first draft.** That draft claimed "nothing in `packages/*`
> changes, and exactly one behaviour-neutral extraction happens in `apps/api`".
> Review found two further changes that the phase actually requires — the
> embeddings capability guard and the admin control that depends on it — and a
> third, on-upload extraction, which `/build` pre-flight then found was
> **already implemented** (§5.4). They are enumerated in §5 rather than
> discovered mid-build. **"No restructuring" survives; "nothing changes" did
> not.**

---

## 2. Scope

**In scope:**

- A `deploy/lambda/` package containing Lambda entrypoints and a CDK stack
- Three changes inside the existing tree (§5)
- ADR-056, recording the second-topology decision
- An installation guide, an update runbook, and a CI job for `deploy/lambda`

**Out of scope:**

- Replacing the Postgres `LISTEN`/`NOTIFY` session event bus with a managed push
  service. Named as a possible follow-on in §7.1; not planned here.
- Promoting `TtlCache` and `IRateLimiter` to Redis — that work belongs to
  the *Scaling With New Infrastructure* phase doc.
- Local / air-gapped embeddings on Lambda (§7.5).
- Azure Functions, GCP Cloud Run Functions, and multi-region deployment.

---

## 3. Why this needs no restructuring

The claim in §1 rests on seams that already exist. Each was **re-verified against
the tree during `/doc-review`** and the line references below are the verified
ones:

| Seam | Where | Why it matters |
|---|---|---|
| Entrypoint-per-runtime is already the pattern | `docker-entrypoint.sh` selects `web` / `api` / `migrate` from one image | A Lambda deployment is a fourth set of entrypoints, not a new architecture |
| The workers are already tick functions | `packages/adapters/src/scheduling/scheduler-worker.ts:37` — `start()` is `setInterval(() => void this.tick())` | An EventBridge-driven handler calls `tick()` once and returns. `tick()` is public and guards its own re-entrancy |
| Concurrent ticks are already safe | The claim paths use `FOR UPDATE SKIP LOCKED` (ADR-019, ADR-033 §6) | Overlapping invocations cannot double-fire a schedule or a batch |
| Scheduling already crosses an HTTP boundary | `apps/web/src/app/api/internal/scheduler/tick/route.ts`, secret-protected via `SCHEDULER_TICK_SECRET`; the api side is `apps/api/src/scheduler/http-tick-firer.ts` | EventBridge Scheduler can drive it directly; the `api` process loses its scheduling role entirely (§4.2) |
| Migrations are already discrete | ADR-047; `apps/api/src/cli/migrate.ts` | A one-shot handler, no start-path coupling. It also takes a Postgres advisory lock, so it is safer than ADR-047 §4 promised |
| Storage already speaks S3 | `MinioStorageAdapter`, parameterised by `MINIO_PATH_STYLE` and `MINIO_REGION` (`apps/web/src/lib/env.ts:126,128`) | Native S3 needs configuration, not code. **The flags are env, resolved at wiring — not fields on the adapter file** |
| Embeddings are already swappable | ADR-017 dispatching adapter, and `createTransformersExtractorFactory` already defers transformers.js behind a lazy `import()` (`local-embeddings-adapter.ts:30`) | `EMBEDDINGS_PROVIDER=openai` drops `onnxruntime-node` from the deployment, and the existing dynamic import is where the §7.5 capability probe belongs |
| Express is already a pure builder | `apps/api/src/app.ts:10` — `buildApp(container)` | Wraps in an adapter with no changes to route code |
| The web container is a lazy singleton | `apps/web/src/lib/container.ts:786` — `getContainer()` memoises on a global | Correct across warm invocations with no change. The v1.9.4 "not on serverless" caveat is about Edge Runtime and isolated VM contexts, not Node Lambda; the memoisation is per-instance, which is exactly what §7.3 books |

### 3.1 One seam gap the handlers must close

`jobs.register()` is called **only** in `start()` — `scheduler-worker.ts:38`,
`retention-worker.ts:39`, `extraction-worker.ts:40` — never in `tick()`. A
tick-only handler therefore calls `jobs.ping()` / `jobs.fail()` for a job name
that was never registered, so `job_registry` — the admin-visible health surface
for these workers under ADR-019 — is never populated on Lambda.

The tick path itself needs no change, so §1 holds. **Each tick handler registers
its job name once per cold start, before the first tick.** This is handler code
in `deploy/lambda/`, not worker code; it is written down here so it is built
rather than discovered via an empty admin jobs page.

---

## 4. What is built

### 4.1 Placement — `deploy/lambda/`, outside the pnpm workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `mocks`. A package under
`apps/` would therefore be pulled into the workspace automatically, with three
consequences for **every other provider** (ADR-056 §2):

1. **The Docker build would break.** The `Dockerfile` copies each workspace
   manifest by name (lines 16–22) and then runs `pnpm install --frozen-lockfile`.
   A new workspace member present in the lockfile but absent from that COPY list
   fails the install.
2. **The published image would grow.** The Dockerfile deliberately does not run
   `pnpm prune --prod` (it says why). CDK and the Lambda adapters would ship
   inside the image pushed to Azure Container Apps and ECS.
3. **`validate.sh` and turbo would sweep it** — `find packages/*/src apps/*/src`
   at `validate.sh:288`, `:355` and `:372`.

`deploy/lambda/` sits outside all three globs. `pnpm lint`, `typecheck` and
`test` are all `turbo run`, so they genuinely will not see it — verified.

**Two things placement does not give for free, and which are deliverables:**

- **`deploy` must be added to `.dockerignore`.** `Dockerfile:25` is `COPY . .`
  and the runtime stage is `COPY --from=build /app /app`, so without this line
  the handler and CDK **source** ships inside every image pushed to GHCR, ECS
  and Azure Container Apps. `node_modules` is already excluded, so the CDK
  *dependency tree* never shipped — but "zero blast radius by construction" is
  only true once this line exists. It is one line, and `.dockerignore` is not on
  the frozen-file list in §13.
- **A CI job for `deploy/lambda` is required** (§12 step 9), because an
  out-of-workspace package that nothing typechecks is exactly how handlers drift
  away from `container.ts`. It must run the **dependency audit** too:
  `validate.sh` §11 and `ci.yml`'s security job both scan the workspace via
  `scripts/audit-check.sh`, so an out-of-workspace lockfile carrying CDK and the
  OpenNext toolchain is otherwise a dependency surface with no owner.

Two residual, non-blocking leaks worth knowing rather than fixing: root
`pnpm format` is repo-wide prettier (`**/*.{ts,tsx,json,md}`), and `validate.sh`
§20 does `find . -name "*.sh"`. Neither breaks anything; both mean "invisible" is
a slight overstatement.

### 4.2 Contents

```
deploy/lambda/
  package.json            # own dependencies, own lockfile; not a workspace member
  handlers/
    container.ts          # one api container per execution environment
    api.ts                # buildApp(container), via an Express→Lambda adapter
    tick.ts               # shared: register the job once, then tick
    tick-extraction.ts    # ExtractionWorker.tick()
    tick-retention.ts     # RetentionWorker.tick()
    migrate.ts            # the ADR-047 migrate command, one-shot
  infra/                  # CDK stack: functions, EventBridge rules, RDS Proxy,
                          # S3, Function URL, CloudFront, secrets wiring
  README.md               # points at docs/guides/setup-aws-lambda.md
```

**There is no `web.ts`.** The draft listed one. OpenNext does not take a handler
entry file — it builds the Next.js app from a stock `next build` and emits its
own server bundle at `apps/web/.open-next/server-functions/default/index.mjs`,
which the CDK stack packages directly. Verified against `@opennextjs/aws@3.10.4`
in `node_modules`. That the build is stock is exactly why OpenNext was chosen
over the Lambda Web Adapter, whose `output: "standalone"` requirement would
change the web build for every provider.

Every handler imports the existing containers and use-cases. None of them
reimplements framework behaviour; a handler that needs to do so is a signal the
seam is missing and should be raised rather than worked around.

**No `tick-scheduler.ts`.** The first draft listed both a
`SchedulerWorker.tick()` handler *and* "EventBridge Scheduler POSTing the
existing tick endpoint" as alternatives. They are different designs, and the
review settled it: `SchedulerWorker`'s firer is `HttpTickFirer`, which POSTs the
web tick endpoint, so a scheduler Lambda would be a function whose entire job is
to HTTP-call another function. **EventBridge Scheduler POSTs
`/api/internal/scheduler/tick` directly**, carrying `SCHEDULER_TICK_SECRET` in
the `x-scheduler-secret` header. One fewer function, one fewer hop, and the
authorisation path is the one already in production.

The retention and extraction workers do own their work in-process, so they keep
real tick handlers.

**Tooling choice is not settled by this doc.** OpenNext (`@opennextjs/aws`) is
the presumed route for the web handler specifically because it builds from a
standard `next build` and therefore requires no change to `next.config.ts` — the
Lambda Web Adapter alternative needs `output: "standalone"`, which would change
the web build output for every provider and must not be adopted casually
(ADR-046 deferred it for the same reason). Per the code-writing rules, whichever
packages are chosen must have their exact API verified in `node_modules` at
build time rather than assumed.

---

## 5. Changes inside the existing tree

Three, enumerated. Each states what it costs the other deployment paths.

### 5.1 Extract the api start path — `apps/api/src/workers.ts`

`apps/api/src/index.ts` calls `app.listen()` at line 18 and starts three worker
loops **as import side effects**. A Lambda handler importing the api package
would boot an HTTP server and three pollers inside the execution environment.

**This is an extraction, not a move:**

- Move the `listen` call and the worker startup into an exported
  `startWorkers(container)` / server bootstrap in a new `apps/api/src/workers.ts`
- `index.ts` remains the process entrypoint and immediately calls it
- `package.json`'s `start` script, `esbuild.config.mjs`'s `entryPoints`, and
  `docker-entrypoint.sh` are **all unchanged**

*Cost to other providers: none.* Runtime behaviour on ECS, Azure, EC2 and
Railway is identical before and after, and §13 makes CI prove it rather than
asserting it. Any proposal that changes the `api` start path is out of bounds
for this phase.

### 5.2 Fail fast when the resolved embeddings provider cannot be loaded — `packages/adapters`

Per ADR-056 §4. The dispatching adapter (`packages/adapters/src/ai/embeddings-adapter.ts`)
returns a named domain error when the active provider cannot be loaded, instead
of letting `LocalEmbeddingsAdapter.embed` surface an opaque module-not-found from
its lazy `import("@huggingface/transformers")`.

Detection is **by capability, not by platform**: probe whether the transformers.js
entrypoint resolves, cached per instance. Sniffing `AWS_LAMBDA_FUNCTION_NAME`
would answer the wrong question and would be right only by coincidence.

*Cost to other providers: none in behaviour, and a strict improvement in
diagnosis.* A container with the embeddings path intact probes `true` and takes
exactly today's code path. **This is a change under `packages/` and therefore
amends the frozen-file list in §13** — the first draft's blanket "no change under
`packages/`" criterion was written before this change was in scope.

### 5.3 Disable the `local` option in `/admin/settings` where it cannot be honoured — `apps/web`

`settings.getEmbeddingsConfig` (`apps/web/src/server/routers/settings.ts:380`)
returns the probe result alongside the config; `RagEmbeddingsCard`
(`apps/web/src/components/settings/rag-embeddings-card.tsx`) disables the option
and shows why. `setEmbeddingsConfig` rejects a provider that cannot be loaded
**server-side** — a disabled control in the UI is a courtesy, not a guard.

*Cost to other providers: none.* Where both providers load, the control behaves
exactly as it does today.

### 5.4 ~~Invoke extraction on upload~~ — **already implemented; no change needed**

The first draft, and the `/doc-review` revision after it, both listed this as a
change to build. **Pre-flight reading found it already shipped.**

`apps/web/src/components/extraction/run-progress.tsx:61` already drives
`trpc.extraction.tick` in a loop while a run is live, and the tRPC procedure
(`apps/web/src/server/routers/extraction.ts:576`) carries a comment naming this
exact case:

> The batch engine is a poller in `apps/api`, so without this a run makes no
> progress until the next sweep — **and none at all if that process is not
> running**. The run screen drives it while the run is live; document claiming
> is `FOR UPDATE SKIP LOCKED`, so this never double-processes against the worker.

That is the Lambda mitigation, built for a different reason and already in
production. An operator watching the progress bar advances the run at browser
speed regardless of what the background engine is doing.

**The phase therefore makes three in-tree changes, not four**, and §1's "no
restructuring" constraint holds more strongly than the revision claimed.

---

## 6. Deployment topology — hybrid

| Wayfinder piece | Lambda deployment |
|---|---|
| `web` (Next.js) | Lambda behind a Function URL in `RESPONSE_STREAM` mode, fronted by CloudFront |
| Scheduler tick | EventBridge Scheduler POSTing the existing tick endpoint (§4.2) |
| Extraction tick | Lambda on EventBridge, plus on-demand invocation at upload (§5.4, §7.4) |
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

**Wayfinder on Lambda is not "serverless Wayfinder"**, and the guide must not
describe it that way.

### 7.2 Rate limiting becomes per-instance

`InMemoryRateLimiter` is process-scoped
(`packages/adapters/src/rate-limit/in-memory-rate-limiter.ts:21`). Across Lambda
instances the effective ceiling is `configured limit × concurrent instances`.
The guide must state this plainly. Budget enforcement (ADR-027) is unaffected
because it is DB-backed.

The same applies to the `LlmCallGovernor` concurrency semaphore, which stops
bounding total in-flight model calls — the same per-instance math
the *Scaling With New Infrastructure* phase doc item 7 already documents.

### 7.3 Cache hit rates fall

The auth and permission `TtlCache` layers barely warm across cold instances,
raising per-request DB reads. This is the same pressure
the *Scaling With New Infrastructure* phase doc addresses with Redis; Lambda encounters it
earlier. Sizing guidance in the guide must account for it.

### 7.4 Extraction tick cadence — already mitigated

`ExtractionWorker`'s default is a 5s tick (`extraction-worker.ts:14`), chosen
because an operator is watching a progress bar. EventBridge's floor is 60s, so
the *background* cadence is 12x slower on Lambda.

**This does not reach the operator**, because the run screen already drives the
batch engine itself (§5.4). The 60s EventBridge rule is the backstop for runs
that outlive the browser session; the interactive path is unaffected. Step
Functions and SQS remain alternatives the guide may mention but this phase does
not build.

The guide must still state the background cadence, because a run left unattended
drains 12x slower on Lambda than on a container.

### 7.5 Hosted embeddings only, enforced rather than documented

Lambda requires `EMBEDDINGS_PROVIDER=openai` (or a Bedrock embeddings adapter).
This drops `onnxruntime-node` and its model from the artefact, which keeps cold
starts sane and allows a zip-based deployment.

The first draft treated this as a deployment constant. It is not: **ADR-017
Decision 1 makes the provider runtime-switchable** through `/admin/settings`,
persisted in `admin_system_settings` and read via `RuntimeConfigStore`, with
`local` as the shipped default. An admin flipping that setting on Lambda would
move RAG onto a code path whose native binary is not in the artefact — a runtime
failure with no deploy-time signal, in the one deployment where the setting is
not actually honourable.

So the constraint is enforced in three places (ADR-056 §4):

1. The dispatching adapter fails fast with a named error (§5.2)
2. `/admin/settings` disables the option it cannot honour, server-side (§5.3)
3. The guide states it, and the troubleshooting table carries the symptom

**Accepted imprecision.** In the hybrid, the always-on SSE service runs the
container image and *can* load `local`, so the two halves would report different
capability. This stays theoretical because CloudFront routes only the SSE path to
that service — `/admin` is always Lambda-served. The guide states it rather than
relying on the routing being remembered.

**Air-gapped and local-model deployments stay on the container path** — the guide
must say so directly rather than leaving operators to discover it.

### 7.6 Connection budget

Lambda concurrency multiplied by pool size will exhaust RDS without a proxy. The
`LISTEN` connection needs session mode, which RDS Proxy does not provide — hence
`DATABASE_LISTEN_URL` against the direct endpoint, exactly as
`packages/adapters/src/messaging/create-session-event-bus.ts` anticipates,
`apps/web/src/lib/container.ts:279` consumes, and `setup-aws.md` already documents.

---

## 8. Installation guide — `docs/guides/setup-aws-lambda.md`

A new guide, structured to mirror [`setup-aws.md`](../../guides/setup-aws.md) so
an operator moving between them recognises the shape. It must cover:

1. **What Wayfinder actually needs** — the same four requirements, with the
   Lambda-specific note that one always-on service remains for SSE, stated up
   front rather than in a footnote
2. **Mapping the pieces to AWS services** — the §6 table
3. **Prerequisites** — RDS with pgvector, the S3 bucket and its IAM user (the
   storage adapter signs with a static key pair, not the execution role), and
   Secrets Manager
4. **Deploying the stack** — CDK bootstrap and deploy, with the migrate
   invocation ordered *before* the web function serves traffic
5. **Environment variable mapping** — including `DATABASE_LISTEN_URL`,
   `EMBEDDINGS_PROVIDER`, `SCHEDULER_TICK_SECRET`, `MINIO_PATH_STYLE=false`, and
   a note that `RUN_MIGRATIONS_ON_START` is moot here because OpenNext invokes
   the Next server handler directly and never runs the `start` script that
   `migrate-if-configured.sh` hangs off
6. **First login and verification** — the `/setup` flow, mirroring `setup-aws.md` §9–10
7. **Constraints and cost shape** — §7 in operator language, especially the SSE
   concurrency bill and the extraction cadence
8. **Troubleshooting** — a table in the same format, seeded with: streams cut at
   15 minutes, `LISTEN` failures behind RDS Proxy, connection exhaustion,
   cold-start latency, and the disabled local-embeddings control

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

the *Scaling With New Infrastructure* phase doc
states at `:104` that `apps/api` runs as "a **separate always-on service** —
never serverless, the scheduler is a long-lived polling loop", and repeats it at
`:135` ("keep off serverless").

That was accurate when written. The tick-per-invoke shape makes it obsolete: the
polling loop is a property of `index.ts`, not of the worker. Both lines must be
revised to point here rather than left contradicting a shipped capability.

A repo-wide check during review confirmed these are the **only** two such
statements — nothing in `adr/`, `prd/` or `guides/` claims Wayfinder cannot run
serverless.

---

## 11. Database changes

**None.** No schema change, no migration, and therefore no `-- data-impact:`
declaration. This is also why the rollback story in §9 is simple — a point worth
stating rather than leaving implicit.

---

## 12. Implementation order

1. Write **ADR-056** (already drafted alongside this revision) — the
   second-topology decision is recorded before the second topology exists
2. Extract `startWorkers` from `apps/api/src/index.ts` (§5.1); prove the
   container start path is unchanged before anything else is built
3. The embeddings capability probe and fail-fast guard (§5.2), then the admin
   control that reads it (§5.3) — tests first, per the code-writing rules. These
   are the only changes touching shared code and they land while the diff is
   still small enough to review closely
4. Scaffold `deploy/lambda/` with its own manifest and lockfile; add `deploy` to
   `.dockerignore`; confirm the package is invisible to `pnpm install`, turbo and
   `validate.sh` at the repo root
5. Verify the chosen Lambda tooling APIs in `node_modules` — do not rely on
   assumed package shapes
6. Tick handlers first (retention, extraction), including the once-per-cold-start
   `jobs.register()` call (§3.1): smallest surface, and they prove the container
   imports cleanly under Lambda
7. The migrate handler, then the api handler, then the web handler — the web
   handler last because it is the one with real packaging risk
8. CDK stack, including RDS Proxy, the `DATABASE_LISTEN_URL` split, and the
   EventBridge Scheduler rule against the existing tick endpoint
9. A CI job for `deploy/lambda` — typecheck, lint, tests **and dependency
    audit**. **Required, not optional** (§4.1)
10. Extend `ci.yml`'s `compose-smoke` job to assert all three worker log lines,
    not only `scheduler heartbeat started` (§13)
11. `setup-aws-lambda.md`, the `upgrading.md` section, the `setup-aws.md`
    cross-link, and the §10 corrections
12. `./validate.sh` and fix all failures

---

## 13. Acceptance criteria

- [ ] `./validate.sh` passes
- [ ] The container image builds unchanged, and `docker compose -f docker-compose.prod.yml up -d` brings up web, api and migrate exactly as before
- [ ] `git diff` shows no change to `Dockerfile`, `docker-entrypoint.sh`, `docker-compose.prod.yml`, `pnpm-workspace.yaml`, `turbo.json`, `next.config.ts`, `esbuild.config.mjs`, `restart.sh` or `scripts/`. Changes under `packages/` and `apps/web` are limited to the three enumerated in §5 — **nothing else**
- [ ] `.dockerignore` excludes `deploy`, and `docker build` produces an image containing no `deploy/` path
- [ ] `apps/api` starts identically: server listening, three workers running, same log lines — **proven by `ci.yml`'s `compose-smoke` job**, extended to assert the retention and extraction startup lines alongside the existing `scheduler heartbeat started` grep (`ci.yml:183`)
- [ ] With both providers loadable, `/admin/settings` embeddings behaviour is byte-for-byte unchanged; with `local` unloadable, the option is disabled in the UI **and** `setEmbeddingsConfig` rejects it server-side, both covered by tests
- [ ] The deploy pipeline runs the migrate handler to completion **before** the web function is pointed at traffic, and a failed or skipped migrate is a visibly failed pipeline step. *(Restated from the first draft, which claimed the web function "refuses to serve against an unmigrated schema" — it does not, and never has. ADR-047's Consequences and `setup-aws.md`'s troubleshooting table both record that an unmigrated deployment starts and then fails at first query. Asserting a boot-time schema gate would be inventing behaviour; building one is a separate phase.)*
- [ ] A deployed stack completes the first-run `/setup` flow, runs a chat turn with streaming, fires a scheduled session, and completes an extraction batch. **Manual, and recorded**: run against a named throwaway stack, with the result and stack identifier written into the phase summary. It is the only end-to-end proof this target works and must not be a remembered tick
- [ ] The CI job for `deploy/lambda` fails when a handler is broken against a `container.ts` change, and runs the dependency audit over its own lockfile
- [ ] `setup-aws-lambda.md` and the `upgrading.md` Lambda section exist and state every §7 constraint
- [ ] ADR-056 exists and is referenced from this doc
- [ ] the *Scaling With New Infrastructure* phase doc's two "never serverless" statements are corrected

---

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| **SSE economics surprise operators** | The guide states the concurrency cost explicitly; the hybrid keeps it on always-on compute where it is predictable |
| **Silent drift** — `deploy/lambda` is outside the workspace, so nothing typechecks it against `container.ts` | The CI job at step 9 is a required deliverable, not a nice-to-have |
| **Unaudited dependency surface** — an out-of-workspace lockfile carrying CDK and OpenNext is invisible to `scripts/audit-check.sh` | The same CI job runs the audit over `deploy/lambda`'s own lockfile |
| **Lambda source leaking into the published image** — `Dockerfile:25` is `COPY . .`, so placement alone does not keep it out | `deploy` added to `.dockerignore`, asserted in §13 |
| **Connection exhaustion under load** — fails at load, not at deploy | RDS Proxy plus the `DATABASE_LISTEN_URL` split, and a load check before sign-off |
| **`pdf-parse` packaging** — it reads its own package files at runtime and is `external` in both existing builds | Prove it resolves inside the Lambda artefact during step 7, not after deployment |
| **The three in-tree changes creep into four** | §5 enumerates them with their cost to other providers; §13 freezes everything else. A fourth change is a signal to stop and re-review, not to widen the diff |
| **Doc rot** — a fourth provider guide is a fourth thing to keep true | The guide states the container path is the tested reference; Lambda is additive (ADR-056 §1) |

**Open questions resolved by `/doc-review` (2026-09-05):**

1. *Is the always-on SSE service acceptable?* **Yes** — booked as §7.1 and
   ADR-056 §3, with the explicit rule that no guide may call this
   "serverless Wayfinder".
2. *Should on-demand extraction invocation be in this phase?* **Moot** — it is
   already implemented (§5.4). `run-progress.tsx` has driven the batch engine
   from the run screen since ADR-033 shipped.
3. *Does `deploy/lambda` warrant an ADR?* **Yes** — ADR-056. A PRD was
   considered and declined: `container-distribution.prd.md` set the precedent,
   but that phase changed how every deployment works, while this one is additive
   by design.
4. *How is embeddings capability determined?* **By capability probe, not
   platform sniffing** — ADR-056 §4, with the hybrid's residual imprecision
   accepted and documented in §7.5.

---

## 15. Provenance

Generated by `/new-feature` on 2026-09-02 from an investigation of the
deployment path, following the approved change summary. Decisions taken at
planning time: hybrid topology, `deploy/lambda/` placement, hosted embeddings
only, and installation plus update guides matching the other providers.

Revised 2026-09-05 after `/doc-review`, which returned four failures: a stale
target version (0.33.0 was already shipped), a contradiction with ADR-017 over
runtime provider switching, an acceptance criterion asserting behaviour that does
not exist, and a missing decision record. All four are resolved above; the
"exactly one change" framing in §1 was the casualty, and the doc is more honest
for losing it.

---

## 16. Approved change summary (`/build`, 2026-09-05)

Wayfinder gains an AWS Lambda deployment target: a `deploy/lambda/` package
outside the pnpm workspace holding Lambda entrypoints and a CDK stack, plus an
installation guide and update runbook. The container image stays the reference
deployment and is provably unaffected. Three small changes land inside the
existing tree — extracting the `apps/api` start path so a handler can import the
container without booting a server, and making the embeddings provider's
*availability* a discovered fact rather than an assumed one. No schema change,
no new ports, no new adapters.

**Pre-flight correction:** §5.4 was found already implemented and is struck out
above. Four in-tree changes became three.

### Goal

- An AWS option with no always-on web or worker compute, for pilots and
  low-duty-cycle tenants where a 24/7 Fargate pair is poor value
- The Docker Compose, ECS, Azure and Railway paths behave identically before and
  after, proven in CI rather than asserted

### Business rules changing

- When the active embeddings provider cannot be loaded by the running artefact,
  `embed()` returns a named `INFRA_FAILURE` rather than an opaque
  module-not-found surfaced from a lazy import
- When `local` is unloadable, `setEmbeddingsConfig` rejects it server-side and
  `/admin/settings` disables the option. Where both providers load, behaviour is
  unchanged

### UI / visible behaviour

- `/admin/settings` → RAG embeddings card: the `local` option is disabled, with
  the reason shown, where the artefact cannot load it

### Data & types

- No domain entities change. `getEmbeddingsConfig` gains an availability field
  on its return shape

### Files & packages touched

- **adapters** — `ai/local-embeddings-adapter.ts` (probe),
  `ai/embeddings-adapter.ts` (guard), plus tests
- **apps/api** — new `src/workers.ts`; `src/index.ts` reduced to a call; test
- **apps/web** — `server/routers/settings.ts`,
  `components/settings/rag-embeddings-card.tsx`, plus tests
- **deploy/lambda** — new, outside the workspace
- **root** — `.dockerignore`, `.github/workflows/ci.yml`, guides, `VERSION`,
  `package.json`

### Database & migration impact

- None. No table, no migration, no `-- data-impact:` line

### Tests

- A test file before each implementation file, per sub-component
- **No e2e.** No part of this phase falls into the six groups in
  `e2e-test-policy.md`: the admin control is a component test, the guard an
  adapter test, the api bootstrap a unit test. Group 6 (smoke) is already
  carried by `ci.yml`'s `compose-smoke` job, which this phase extends

### Version, branch & PR target

- **MINOR → 0.34.0.** Branch `claude/lambda-deployment-target-phase-dmbgwa`
  (the session's designated branch, in place of `feature/<slug>`); PR against
  `main`

### Risks

- The CDK stack and OpenNext packaging cannot be verified in this environment —
  no AWS account, no deploy. The implementation summary states exactly what is
  and is not proven
- `deploy/lambda` is outside the workspace, so only its own CI job catches drift

### Out of scope

- Replacing the `LISTEN`/`NOTIFY` bus, Redis promotion, air-gapped embeddings on
  Lambda

### Decomposition

1. `apps/api` start-path extraction
2. Embeddings capability probe and fail-fast guard
3. Admin control that reads the probe
4. `deploy/lambda` scaffold and the `.dockerignore` line
5. Handlers
6. CDK stack
7. CI job and the `compose-smoke` extension
8. Guides, the §10 corrections, and the §5.4 correction
9. Version bump, doc move, implementation summary, PR
