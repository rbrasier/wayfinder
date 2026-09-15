# ADR-056 — Lambda Is a Second Deployment Topology, Not a Replacement

- **Status**: Proposed (scoped by `lambda-deployment-target.phase.md`)
- **Date**: 2026-09-05
- **Builds on**: ADR-046 (the container image is the distribution unit — the
  artefact this ADR declines to replace), ADR-047 (migrations as an explicit
  command — what makes a one-shot migrate handler possible), ADR-019 (in-app
  scheduler — the tick shape this rests on)
- **Refines**: ADR-017 Decision 1 — the embedding provider is runtime-switchable,
  but only between providers the running artefact can actually load

## Context

Wayfinder deploys as one container image running `web`, `api` or `migrate`
(ADR-046). On AWS that is two always-on Fargate services. For a pilot, a
demonstration tenant, or an organisation running a handful of sessions a week,
a 24/7 pair is poor value — the compute is idle almost all of the time, and the
cost is the first thing a prospective operator asks about.

The seams that would make a serverless target possible already exist, and were
built for other reasons:

- The workers are tick functions (`SchedulerWorker.tick()`), and `start()` is
  only `setInterval` over them. The polling loop is a property of
  `apps/api/src/index.ts`, not of the worker.
- Concurrent claiming is already safe — `FOR UPDATE SKIP LOCKED` (ADR-019).
- Migrations are already a discrete command (ADR-047).
- Storage already speaks S3; embeddings are already swappable (ADR-017);
  `buildApp(container)` is already a pure builder.

So the question is not *can* Wayfinder run on Lambda. It is what adding a second
topology commits the project to, and what it must promise not to become.

## Decision

### 1. Lambda is additive. The container image stays the reference deployment.

The published image remains the artefact ADR-046 describes: the thing that is
built on every pull request, smoke-tested in CI against `docker-compose.prod.yml`,
and named first in every guide. Lambda is a fourth provider path alongside
Docker Compose, ECS Fargate, Azure Container Apps and Railway.

This is the load-bearing decision. A second topology that quietly became the
canonical one would mean two things to keep true with only one of them tested,
and ADR-046's whole argument — that a version skew between deployment halves is
a silent failure — applies with more force, not less, when the halves are
packaged differently.

**Concretely: when the two paths disagree, the container path wins**, and the
Lambda guide says so.

### 2. `deploy/lambda/` sits outside the pnpm workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `mocks`. A package under
`apps/` would be pulled into the workspace automatically, with three consequences
for **every other provider**:

1. The `Dockerfile` copies each workspace manifest by name and then runs
   `pnpm install --frozen-lockfile`. A new workspace member present in the
   lockfile but absent from that COPY list fails the install.
2. The published image would carry CDK and the Lambda toolchain, because the
   Dockerfile deliberately does not prune dev dependencies.
3. `validate.sh` and turbo would sweep it.

`deploy/lambda/` sits outside all three globs. Two things follow that are
obligations, not conveniences:

- **`deploy` is added to `.dockerignore`.** Being outside the workspace stops
  the *dependencies* shipping, but `Dockerfile`'s `COPY . .` would still copy the
  handler and CDK **source** into every published image. Without this line the
  blast radius is small but not zero.
- **A dedicated CI job is mandatory** (typecheck, lint, test, dependency audit).
  An out-of-workspace package that nothing checks is exactly how handlers drift
  away from `container.ts`, and an out-of-workspace lockfile that nothing audits
  is a dependency surface with no owner.

### 3. The topology is hybrid, and that is the honest shape

The SSE session-event stream holds a long-lived connection backed by a Postgres
`LISTEN` subscription. On Lambda every open chat tab would pin a billed
concurrent execution up to the 15-minute ceiling and then drop regardless of
client state.

One small always-on service keeps that path, fronted by CloudFront. **Wayfinder
on Lambda is not "serverless Wayfinder"** and no guide may describe it that way.
Making it fully serverless means replacing the session event bus adapter
(AppSync Events, IoT Core, API Gateway WebSockets) and changing the client
`EventSource` — a separate phase, deliberately not taken here.

### 4. Provider capability is a property of the artefact, detected not configured

ADR-017 Decision 1 makes the embedding provider runtime-switchable through
`/admin/settings`. That decision assumed both providers are always loadable,
because in a container they are. A Lambda artefact ships without
`onnxruntime-node` — it is what keeps cold starts sane and allows a zip-based
deployment — so an admin switching to `local` would move RAG onto a code path
whose native binary is not present.

The provider stays switchable. What changes is that **the set of switchable
providers is discovered rather than assumed**:

- `createTransformersExtractorFactory` already loads transformers.js through a
  lazy dynamic import, so resolvability is a cheap, honest probe.
- The dispatching adapter fails fast with a named domain error when the resolved
  provider cannot be loaded, instead of surfacing an opaque module-not-found at
  query time.
- `/admin/settings` reads the same probe and disables the provider it cannot
  honour, with the reason shown.

Detection is by capability, not by platform. Sniffing `AWS_LAMBDA_FUNCTION_NAME`
would answer the wrong question — it would also be wrong for a container built
without the embeddings path, and right only by coincidence.

**Accepted imprecision:** in the hybrid, the always-on SSE service runs the
container image and *can* load `local`, so the two halves would report different
capability. This stays theoretical because CloudFront routes only the SSE path to
that service — `/admin` is always Lambda-served. The guide states it rather than
relying on the routing being remembered.

### 5. No new ports, no new adapters, no schema change

Every handler imports the existing containers and use-cases. A handler that
needs to reimplement framework behaviour is a signal that a seam is missing, and
is raised rather than worked around.

## Alternatives considered

- **Fully serverless, replacing the `LISTEN`/`NOTIFY` bus.** Deferred, not
  rejected: it is the right end state, but it changes an adapter every
  deployment uses and the client that consumes it. Doing it inside a phase whose
  premise is "no restructuring" would make that premise false.
- **Lambda Web Adapter instead of OpenNext.** Rejected for now: it requires
  `output: "standalone"` in `next.config.ts`, which changes the web build output
  for *every* provider. ADR-046 already deferred standalone output for the same
  reason. OpenNext builds from a stock `next build`.
- **API Gateway in front of the web and chat paths.** Not usable: it cannot
  stream and caps at 30s, against a turn that runs to roughly 300s. Function URLs
  with response streaming are the only viable front door.
- **`deploy/lambda` inside `apps/`.** Rejected: see §2. It breaks the Docker
  build for every other provider on the first `pnpm install`.
- **A separate repository for the Lambda target.** Rejected on ADR-046's own
  reasoning: handlers that import `container.ts` must be built from the same
  tree, or they drift silently against a `container.ts` they no longer see.
- **Step Functions or SQS for extraction cadence.** Deferred: on-demand
  invocation at upload closes the gap this phase actually has, without adding a
  service the guide would then have to explain.
- **Making Lambda the recommended AWS path.** Rejected, and worth recording as a
  rejection rather than an omission: the container path is what CI exercises.

## Consequences

**Positive**

- An AWS option with no always-on web or worker compute, for the duty cycles
  where a Fargate pair is poor value.
- Every seam it rests on was already there and stays load-bearing for the
  container path too — nothing is built solely for Lambda.
- The embeddings capability probe fixes a latent gap that predates this target:
  a container built without the embeddings path had the same opaque failure.
- The `deploy/lambda` CI job gives the first coverage of whether `container.ts`
  is importable outside a long-lived process.

**Negative**

- **A fourth deployment guide is a fourth thing to keep true**, and the one with
  the least CI behind it. The end-to-end verification of a deployed stack is
  manual and stays manual in this phase.
- The hybrid keeps an always-on component, so the headline benefit is partial.
  An operator expecting scale-to-zero will find one service that does not.
- `deploy/lambda` gets no turbo caching, and its checks are a job that someone
  has to keep passing rather than something the root scripts pick up for free.
- ADR-017's admin control becomes conditional. A setting that is always available
  in a container is sometimes disabled elsewhere — a small but real inconsistency
  in the admin surface.
- Air-gapped and local-model deployments are permanently excluded from this
  target, not merely unsupported at first.
