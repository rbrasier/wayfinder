# Phase — Container Distribution and Release Artifacts

- **Status**: Implemented in v0.24.0 — see `container-distribution.summary.md`
- **Date**: 2026-08-04
- **Target version**: **0.24.0** (MINOR — new build, CI and release capability;
  no schema change, no behaviour change for an existing install)
- **PRD**: [`container-distribution.prd.md`](../prd/container-distribution.prd.md)
- **ADRs**:
  - [ADR-046](../adr/046-container-image-distribution.adr.md) — the container
    image as the distribution unit
  - [ADR-047](../adr/047-migrations-as-explicit-command.adr.md) — migrations as
    an explicit command
- **Depends on / relates to**:
  - ADR-017 (embedding providers — the glibc and image-size constraint)
  - ADR-019 (in-app scheduler) and ADR-033 §6 (extraction worker) — why `api` is
    a distinct long-lived process that must not scale to zero
  - ADR-041 (first-run wizard, DB-first config) — why the image ships no
    credentials, and the zero-config local promise slice 2 must not break
  - The scaling-with-new-infrastructure phase doc listed "Dockerfiles +
    object-storage parametrisation" as a future slice. **This phase claimed the
    Dockerfile half**; object-storage parametrisation stays there, and that doc
    now points at this one.

---

## Goal

Make the deployable artifact a published container image instead of a monorepo
checkout, and give publishing its own operator entry point.

Today `setup-aws.md` and `setup-azure.md` each open with ~40 lines of inline
Dockerfile before reaching a single cloud resource — two copies, built by
nothing, certain to drift. Meanwhile **no CI job runs `pnpm build`**, so the
production build is unverified until someone deploys.

---

## Standing constraint — the minimal environment surface

Every artifact this phase produces, and every guide it touches, asks for the
**same six variables** and no more. `.env.min.example.prod` is the authority:

```
NODE_ENV  DATABASE_URL  BETTER_AUTH_SECRET  SETTINGS_ENCRYPTION_KEY
BETTER_AUTH_URL / WEB_BASE_URL  SCHEDULER_TICK_SECRET
```

Everything else has a working default. Object storage, the AI provider, mail and
sign-in are **configured by the administrator in the setup wizard** (ADR-041),
which tests each connection before accepting it and stores the credential
encrypted with `SETTINGS_ENCRYPTION_KEY`. They are deliberately not deployment
inputs: a platform engineer should not need an Anthropic key to stand the app up,
and an admin rotating an S3 key should not need a redeploy.

`MINIO_*` and the provider keys remain supported as an env-only fallback for
automated provisioning — a stored config always wins over them — but no guide
presents them as the normal path.

Current state, verified while writing this doc:

| Guide | Aligned? |
| --- | --- |
| `setup-aws.md` | Yes — minimal table, wizard-first, env-only under its own heading |
| `setup-azure.md` | Yes — same shape |
| `setup-railway.md` | **Fixed on this branch** — it listed `ANTHROPIC_API_KEY` and six `MINIO_*` vars as required while linking to the file that says otherwise |

**The one place this needs a decision is slice 4.** `docker-compose.prod.yml`
bundles its own MinIO, so its credentials are not a credential the operator
chose — presetting `MINIO_*` there is defensible, and asking an evaluator to
paste `minioadmin` into a wizard is friction with no security benefit. Decide it
explicitly in that slice and record the reasoning; do not let it drift in.

---

## Branch and base

New feature → base branch `main`, per **Release Branching** in `CLAUDE.md`.

> **How this actually landed:** the planning docs and the implementation were
> both written on a branch based on `release/alpha-2` (PR #225), at the author's
> explicit direction after being offered a branch from `main`. The pull request
> targets `main`, so the feature reaches the next release line as the branching
> rules require — but the branch also carries three alpha-2 fix commits that had
> not yet been forward-merged. Reviewers should expect them in the diff.

---

## Slices

Four slices. Each is independently mergeable and independently useful; 1 and 2
are prerequisites for 3.

### Slice 1 — Dockerfile and CI image build

**Ships:** `Dockerfile`, `.dockerignore`, a `docker-image` job in `ci.yml`.

Multi-stage, `node:20-bookworm-slim` base (glibc — `onnxruntime-node` has no musl
build, ADR-017). Build stage runs `pnpm install --frozen-lockfile` then
`pnpm build`. Runtime stage carries the built workspace and defaults its command
to the web process.

A build argument (default off) runs `scripts/fetch-embeddings-model.mjs` to
vendor the local embedding model for air-gapped installs (ADR-046 §5).

The CI job builds on every PR and **discards** — it exists to exercise
`pnpm build`, which nothing does today. Use GitHub Actions layer caching;
expect the first build after any lockfile change to be slow.

**Spike first — resolve before writing the Dockerfile:**

- **Does `next build` need a reachable `DATABASE_URL`?** No module-scope
  `serverEnv()` call was found in `apps/web/src`, but route modules are evaluated
  during build, so this is unproven. If it does, the build stage needs a stub
  value and that must be documented in the Dockerfile with a comment saying why —
  not quietly set.
- **What does the image actually weigh?** Record it. It informs whether slice 1
  should also attempt pruning or leave it to slice 2.

**Acceptance**

- [ ] `docker build .` succeeds from a clean checkout
- [ ] The CI job fails when `pnpm build` fails (verify by breaking it deliberately)
- [ ] Running the image with the web command serves HTTP on `WEB_PORT`
- [ ] Running it with the api command logs `scheduler heartbeat started`
- [ ] `NEXT_PUBLIC_APP_VERSION` in the running image matches the repo `VERSION`
- [ ] `.dockerignore` excludes `.env`, `node_modules`, `.next`, `.turbo`

---

### Slice 2 — The `migrate` entrypoint (ADR-047)

**Ships:** a migrate CLI in `packages/adapters`, a rewritten
`scripts/migrate-if-configured.sh`, the `RUN_MIGRATIONS_ON_START` flag.

Thin CLI over the **existing** `runMigrations` in
`packages/adapters/src/db/migrate.ts` — `drizzle-orm` and `postgres` only, no
`drizzle-kit`. `migrate-if-configured.sh` calls it instead of
`pnpm --filter @rbrasier/adapters db:migrate`, keeps its silent skip when
`DATABASE_URL` is unset, and honours the new flag (default `true`).

**The riskiest part of this phase is the flag's default being the opposite of its
correct production value** (ADR-047, Consequences). Set it to `false` in the
image, the compose file and both cloud guides, or deployments silently keep the
behaviour this slice exists to remove.

**Then verify pruning.** With no runtime path reaching `drizzle-kit`, try
`pnpm prune --prod` in the runtime stage and run both processes. The framework
libraries are `peerDependencies` of `@rbrasier/adapters` but real `dependencies`
of the apps, so this *should* work — verify, do not assume. If it does not, keep
the full install; ADR-047 stands on its other merits and the Dockerfile comment
should record what was tried.

**Acceptance**

- [ ] Test file written before implementation, per `CLAUDE.md`
- [ ] `migrate` against an empty database applies all migrations, exits 0
- [ ] Running it again is a no-op, exits 0
- [ ] Against an unreachable database it exits non-zero with the error
- [ ] With `RUN_MIGRATIONS_ON_START=false` the web process starts without migrating
- [ ] **`./restart.sh` on a clean checkout still migrates and starts, unchanged**
- [ ] `pnpm dev` with no flag set still migrates
- [ ] No runtime path invokes `drizzle-kit` (grep the start scripts)
- [ ] Pruning verified either way, and the result recorded in the Dockerfile

**Docs updated in this slice**

- `setup-aws.md` — delete the "**Do not prune dev dependencies**" paragraph from
  §2 only if pruning was proven to work; promote the one-off migration ECS task
  from a multi-instance caveat to the documented default; drop
  `drizzle-kit: not found` from the troubleshooting table
- `setup-azure.md` — the same three changes against its §2, its Container Apps
  job, and its troubleshooting table
- `.env.example` — document `RUN_MIGRATIONS_ON_START` with the local-vs-deployment
  asymmetry spelled out

---

### Slice 3 — Publish workflow, `/publish` skill, `/release` hand-off

**Ships:** `.github/workflows/publish.yml`, `.claude/commands/publish.md`, an
edit to `.claude/commands/release.md`.

The **workflow is the mechanism**: triggered on `v*` tag push, builds and pushes
`ghcr.io/rbrasier/wayfinder:<version>` with `packages: write` and the built-in
`GITHUB_TOKEN`. No maintainer's laptop in the supply chain. Publish `latest`
**only from a release line, never from `main`** (ADR-046 §2).

`/publish` is the **operator interface** over it, not a reimplementation:

- Verify the tag exists and CI is green on it
- Trigger or locate the workflow run, follow it, report the resulting digest
- Verify the manifest is publicly pullable
- Handle the off-cycle cases the workflow alone cannot: re-publishing after a
  registry failure, publishing a throwaway image from a branch to test a cloud
  deployment
- Be safe to re-run for the same tag

Structure it as **two artifact streams** even though only one ships. The second
is npm: `.changeset/config.json` is live (`"access": "public"`, the four
`@rbrasier/*` packages `linked`, no `private: true` anywhere in `packages/`), so
package publishing is dormant rather than absent. `/publish` should ask which
stream when both exist, and today answer "container image" without asking. The
npm stream is out of scope here — it needs an `NPM_TOKEN`, a changeset-per-PR
convention, and a decision on whether framework versions track `VERSION` (PRD
§11).

`/release` **asks and hands off; it never publishes inline** — a failed push must
not leave a release half-finished:

- **Operation B (tag a build)** — the primary hook. After pushing the tag, offer
  `/publish`. This is where a version exists, so it is where an image tag means
  something.
- **Operation A (cut a line)** — a secondary offer after step 5, for a first
  image on the new line.

**Acceptance**

- [ ] Pushing a `v*` tag publishes `<version>`, pullable anonymously
- [ ] `latest` moves only when publishing from a release line
- [ ] The published image's `VERSION` matches the tag
- [ ] Re-running `/publish` for a published tag is safe and says so
- [ ] `/publish` reports the digest
- [ ] `/release` B offers the hand-off after tagging; A offers it after cutting
- [ ] Neither `/release` operation pushes an image itself

**Docs updated in this slice**

- `setup-aws.md` — **replace §2 "Build a container image" entirely** with the
  published image reference; the Dockerfile and the ECR build/push block go
- `setup-azure.md` — **replace §2** likewise; the `az acr build` block goes,
  though ACR import stays worth a mention for pull-latency or egress reasons
- `docs/guides/managing-releases.md` — where publishing sits, and that `/release`
  hands off rather than publishing
- `docs/guides/skills.md` — `/publish` in the skill table
- `CLAUDE.md` — `/publish` in the Skill Routing table

---

### Slice 4 — `docker-compose.prod.yml`

**Ships:** `docker-compose.prod.yml`, a compose smoke test in CI.

Whole stack on one host: `web`, `api`, Postgres (`pgvector/pgvector:pg16`),
MinIO. Both app services use the **published image** with different commands;
migrations run as a one-shot service the app services depend on.

Distinct from the existing `docker-compose.yml`, which runs infrastructure only
for local development against a host-run app. That file stays exactly as it is —
it serves a different job and `./restart.sh` depends on it.

Watch the details that differ from local:

- Service-name hostnames, not `localhost` — `postgres:5432` (not the `5433` host
  mapping) and `storage:9000`
- Secrets via `.env` file reference, never inline
- `RUN_MIGRATIONS_ON_START=false`, with the migrate service owning it
- No Langfuse — optional, and not part of a minimal production stack
- **No AI provider key.** The stack comes up without one and the wizard
  configures it. An evaluator gets to `/setup` before choosing a provider.
- **Bundled MinIO is the one presetting decision** (see the standing constraint
  above): `MINIO_ENDPOINT=storage`, `MINIO_PATH_STYLE=true` and the compose
  file's own root credentials. Recommended, because those are the compose file's
  own credentials rather than the operator's — but make the call explicitly and
  put the reason in a comment in the file.

This slice is also **the only deployment artifact CI can fully exercise**, since
it runs on the runner itself. Bring the stack up, assert the web app serves
`/setup`, tear it down.

**Acceptance**

- [ ] `docker compose -f docker-compose.prod.yml up -d` on a clean host reaches
      the `/setup` page
- [ ] The migrate service completes before the app services start
- [ ] The api service logs `scheduler heartbeat started`
- [ ] Uploading through the running stack lands an object in MinIO
- [ ] `docker compose down -v` then `up -d` again reaches the same state
- [ ] The CI smoke test fails when the stack does not come up
- [ ] The existing `docker-compose.yml` and `./restart.sh` are untouched
- [ ] The stack comes up with **no AI provider key set anywhere**, and the wizard
      configures one
- [ ] Every environment variable in the file is either one of the six minimal
      vars or carries a comment saying why it is there

**Docs updated in this slice**

- `README.md` — single-host deployment alongside the local quickstart
- `setup-aws.md` / `setup-azure.md` — the "single VM with Docker Compose"
  alternative points at a real file instead of describing one
- `setup-railway.md` — the compose path as an alternative for anyone who would
  rather own one VM than a platform
- `setup-local.md` — note the prod compose exists and what it is for

**Sweep before closing the phase:** re-read the required-environment table in all
three deployment guides against `.env.min.example.prod`. They must agree
variable-for-variable. This is the check that failed silently before — the
Railway guide drifted while linking to the file that contradicted it.

---

## Out of scope

Named so `/doc-review` can weigh them rather than rediscover them:

- **npm publishing** of `@rbrasier/*` — dormant changesets config; its own phase
- **Next.js `output: "standalone"`** — the real answer to image size; changes how
  the web process starts
- **Multi-architecture images** (`arm64`) — additive via `buildx` once single-arch
  works
- **Image signing / SBOM** (cosign, provenance) — first published images will be
  unsigned
- **Kubernetes manifests or a Helm chart** — cheap once an image exists
- **Infrastructure-as-code** (CDK, Bicep, Terraform) — every option gets shorter
  once the build section disappears from the guides
- **A preflight/doctor script** for validating a target environment
- **Object-storage parametrisation** — stays with the scaling-with-new-infrastructure phase

---

## Risks

| Risk | Handling |
| --- | --- |
| `next build` needs `DATABASE_URL` and the Dockerfile is written around a hidden stub | Spike in slice 1 before writing the Dockerfile; if a stub is needed, comment it |
| `RUN_MIGRATIONS_ON_START` default is the opposite of the correct production value | Set explicitly in image, compose and both guides; on the slice 2 checklist |
| `pnpm prune --prod` breaks peer resolution | Verify by building and running; keep the full install if it fails, and record why |
| Image size makes cold starts slow | Measure in slice 1; reinforces min-replicas ≥ 1 already in the Azure guide; standalone output is the deferred fix |
| CI slows down on every PR | Layer caching; accept — it buys the first `pnpm build` coverage the repo has ever had |
| A mistaken public publish is effectively permanent | `/publish` verifies tag and CI green before pushing; versions are immutable, mistakes get a new PATCH |
| These docs are on a `release/alpha-2` branch but implementation targets `main` | Flagged above; forward-merge before `/build` |
| Guides drift back to listing storage/AI vars as required, because a platform's own docs are written that way | The standing constraint above, the slice 4 sweep, and `.env.min.example.prod` as the single authority |
