# PRD — Container Distribution and Release Artifacts

- **Status**: Draft
- **Date**: 2026-08-04
- **Author**: richy.brasier
- **Target version**: 0.24.0 (bump: MINOR — new build, CI and release capability; no schema change, no runtime behaviour change for an existing install)

## 1. Problem

Deploying Wayfinder means cloning a pnpm monorepo and building it. There is no
`Dockerfile` in the repository, so the two cloud deployment guides
(`setup-aws.md`, `setup-azure.md`) each carry a ~40-line Dockerfile inline
before they reach their first cloud resource. Those two copies are already
duplicated, are not built by anything, and will drift the first time a
dependency moves.

Worse, **nothing in CI ever runs `pnpm build`**. `ci.yml` runs typecheck, lint,
test and `validate.sh`; none of them build the web app. The production build is
therefore unverified on every pull request — a `next build` failure would first
be discovered by whoever is deploying.

Two smaller problems compound it:

- The web app's `start` script runs `drizzle-kit migrate` before `next start`.
  `drizzle-kit` is a **devDependency** of `@wayfinder/adapters`, so a production
  image cannot prune dev dependencies without breaking on boot. Every deployment
  guide has to warn about this.
- The same `start` script makes migrations a side effect of web boot, which is
  correct for one instance and a race across several. Both cloud guides work
  around it with a separate one-off task.

`.changeset/config.json` is configured for publishing the four `@wayfinder/*`
packages to npm (`"access": "public"`, a `linked` group, no `private: true` on
any package), but nothing publishes them. That capability is dormant, not
absent, and has no operator-facing entry point.

## 2. Users / Personas

- **Self-hosting platform engineer** — deploys Wayfinder into an existing AWS or
  Azure account. Wants to consume a versioned artifact, not reproduce a build
  toolchain they do not otherwise use.
- **Evaluator running a pilot** — wants the whole stack on one host with the
  fewest possible steps, to decide whether Wayfinder is worth a real deployment.
- **Maintainer cutting a release** — wants publishing to be a discrete,
  retryable step that cannot leave a release half-finished.

## 3. Goals

- A single `Dockerfile` in the repository is the one definition of how Wayfinder
  is built into a runnable artifact.
- CI builds that image on every pull request, so `pnpm build` is exercised
  before merge.
- Tagging a release publishes `ghcr.io/rbrasier/wayfinder:<version>` publicly, so
  a deployer can pull an image instead of building one.
- Both cloud guides replace their "build a container image" section with a single
  `image:` reference.
- `docker compose -f docker-compose.prod.yml up -d` brings up the whole stack —
  web, api, Postgres, MinIO — on one host.
- **Every deployment guide asks for the same minimal environment set** — the six
  variables in `.env.min.example.prod` — and no more. Object storage, the AI
  provider, mail and sign-in are configured by the administrator in the setup
  wizard (ADR-041) and stored encrypted, never handed to a cloud platform's
  secret store as a deployment concern.
- Migrations can be run as an explicit command, so a production image no longer
  needs `drizzle-kit` and a multi-instance deploy no longer races.
- Publishing is invoked through its own `/publish` skill, separate from
  `/release`.

## 4. Non-goals

- **Publishing the `@wayfinder/*` packages to npm.** `/publish` is structured for
  two artifact streams, but only the container stream ships here. See §11.
- **Kubernetes manifests or a Helm chart.** No demand yet; the image makes them
  cheap to add later.
- **Infrastructure-as-code** (CDK, Bicep, Terraform). A published image makes
  every one of those shorter; none of them is in this phase.
- **Next.js `output: "standalone"`.** A worthwhile size reduction, but it changes
  how the web app is started and is a phase of its own. See §11.
- **Changing what `./restart.sh` does for a local developer.** The zero-config
  local path must behave exactly as it does today.

## 5. Key entities

None. This phase adds no domain entities, no ports and no adapters. The
artifacts it produces are build and CI files:

| Artifact | Lives in | New / existing | Notes |
| --- | --- | --- | --- |
| `Dockerfile` | repo root | new | Multi-stage; one image, both processes |
| `.dockerignore` | repo root | new | Keeps `node_modules`, `.next`, `.turbo` out of build context |
| `docker-compose.prod.yml` | repo root | new | Whole stack on one host |
| `migrate` entrypoint | `packages/adapters/src/db/` | extends existing | Thin CLI over the existing `runMigrations` |
| Image publish workflow | `.github/workflows/publish.yml` | new | Builds and pushes to GHCR on tag |
| Image build job | `.github/workflows/ci.yml` | existing | New job; first thing in CI to run `pnpm build` |
| `/publish` skill | `.claude/commands/publish.md` | new | Operator interface over the publish workflow |
| `/release` hand-off | `.claude/commands/release.md` | existing | Offers `/publish` after tagging |

## 6. User stories

1. As a **platform engineer**, I can deploy Wayfinder to ECS or Container Apps by
   referencing a published image tag, so that I never build the monorepo.
2. As a **platform engineer**, I can run migrations as a discrete command against
   my database, so that a multi-instance rollout does not race.
3. As an **evaluator**, I can bring the entire stack up on one VM with a single
   `docker compose` command, so that a pilot takes minutes.
4. As a **maintainer**, I can publish a release image with `/publish`, and retry
   it if the registry fails, without re-running any part of `/release`.
5. As a **maintainer**, I am asked whether to publish after tagging a build, so
   that publishing is not a step I can forget.
6. As a **contributor**, I find out in CI that my change broke `next build`,
   rather than after merge.

## 7. Pages / surfaces affected

No application routes, tRPC procedures or API endpoints change. Surfaces
affected are operational:

- `docs/guides/setup-aws.md` — §2 "Build a container image" is replaced by an
  image reference; the "do not prune dev dependencies" warning is removed once
  ADR-047 lands; the one-off migration task becomes the documented default.
- `docs/guides/setup-azure.md` — the same three changes.
- `docs/guides/setup-railway.md` — brought onto the same minimal env set as the
  other two guides, and pointed at the compose path as an alternative.
- `docs/guides/setup-local.md`, `README.md` — gain the single-host compose path.
- `docs/guides/managing-releases.md` — records where publishing sits.
- `docs/guides/skills.md` — documents `/publish`.

## 8. Database changes

None.

The `migrate` entrypoint runs the **existing** generated migrations through the
existing `runMigrations` helper. No new tables, no new columns, no change to
`packages/adapters/drizzle/`.

## 9. Architectural decisions

New ADRs introduced by this PRD:

- **ADR-046 — Container image as the distribution unit.** One image with the
  runtime command selecting `web` or `api`; published to GHCR, publicly, on
  release tags.
- **ADR-047 — Migrations as an explicit command.** A `migrate` entrypoint built
  on `runMigrations`, with start-time migration becoming an opt-out flag rather
  than an unconditional side effect.

Existing decisions this PRD assumes:

- **ADR-017** (embedding providers) — the local embeddings path pulls
  `onnxruntime-node`, which constrains the base image to glibc and dominates
  image size.
- **ADR-019** (in-app scheduler) and **ADR-033 §6** (extraction worker) — both
  run inside the `api` process, which is why that container must not scale to
  zero and why `api` is a distinct runtime command rather than a second replica
  of `web`.
- **ADR-041** (first-run wizard, DB-first config) — the image ships no
  integration credentials; a container's first boot is expected to land on
  `/setup`.

Related planning docs:

- `to-be-implemented/scaling-new-infrastructure.phase.md` lists "Dockerfiles +
  object-storage parametrisation: **MINOR**" as a future slice. **This PRD claims
  the Dockerfile half of that slice**; object-storage parametrisation stays
  there. That doc should be updated to point here rather than restate it.

## 10. Acceptance criteria

- [ ] A `Dockerfile` at the repo root builds successfully from a clean checkout.
- [ ] CI builds the image on every pull request and fails the build if
      `pnpm build` fails.
- [ ] The built image runs the web process and serves HTTP on `WEB_PORT`.
- [ ] The built image runs the api process, and its log reports the scheduler
      heartbeat starting, when given the same environment.
- [ ] `docker run … migrate` applies migrations to an empty database and exits 0;
      running it a second time is a no-op and exits 0.
- [ ] With migrations already applied, the web process starts without invoking
      `drizzle-kit`.
- [ ] `./restart.sh` on a clean checkout still migrates and starts the app with
      no additional steps — the local developer experience is unchanged.
- [ ] Pushing a `v*` tag publishes `ghcr.io/rbrasier/wayfinder:<version>` and
      `:latest`, both publicly pullable with no credentials.
- [ ] The published image's `VERSION` file matches the tag it was published from.
- [ ] `docker compose -f docker-compose.prod.yml up -d` on a clean host reaches a
      state where the web app serves the `/setup` page.
- [ ] CI runs the compose stack and asserts the web app answers.
- [ ] `/publish` publishes an image for a given tag and reports the resulting
      digest, and is safe to re-run for the same tag.
- [ ] `/release` Operation B offers to hand off to `/publish` after tagging, and
      Operation A offers it after cutting a line.
- [ ] `setup-aws.md` and `setup-azure.md` contain no inline Dockerfile.
- [ ] Every deployment guide's required environment table lists only the
      variables in `.env.min.example.prod`. Storage and AI provider variables
      appear only under an explicitly-labelled env-only-install heading, if at
      all.
- [ ] `docker-compose.prod.yml` sets no AI provider key and no storage
      credential the operator chose — a fresh stack reaches `/setup` and the
      wizard configures both.
- [ ] `./validate.sh` passes.

## 11. Out of scope / future work

- **npm publishing of `@wayfinder/*`.** The changesets config is live and the
  packages are publishable, but shipping it needs an `NPM_TOKEN`, a
  changeset-per-PR convention, and a decision on whether framework versions track
  the app's `VERSION`. Its own phase, its own MINOR bump. `/publish` should be
  shaped so this becomes a second stream rather than a rewrite.
- **Next.js `output: "standalone"`** to cut image size — interacts with the start
  script and the workspace layout.
- **Multi-architecture images** (`linux/arm64` alongside `amd64`). Graviton and
  Azure Ampere are cheaper; `docker buildx` makes this additive once the single-arch
  workflow exists.
- **Image signing and SBOM** (cosign, provenance attestation). Likely required by
  enterprise deployers eventually; not a blocker for alpha.
- **A preflight/doctor script** validating a target environment before first boot.
  Discussed alongside this work but independent of it.
- **Infrastructure-as-code** for AWS and Azure, which this phase makes materially
  cheaper.

## 12. Risks / open questions

- **Does `next build` require a reachable `DATABASE_URL`?** Unknown, and
  currently untestable because CI never builds. No module-scope `serverEnv()`
  call was found in `apps/web/src`, which is encouraging but not proof — route
  modules are evaluated during build. **Resolve by spiking the build first**; if
  it does, the Dockerfile needs a build-time stub value and that must be
  documented, not hidden.
- **Does `pnpm prune --prod` yield a working image once ADR-047 lands?** The
  framework libraries are `peerDependencies` of `@wayfinder/adapters` but real
  `dependencies` of `apps/web` and `apps/api`, so pruning *should* keep them. Not
  verified. If pruning proves unsafe, ADR-047 still stands on its multi-instance
  merits and the image simply stays large.
- **Image size.** `@huggingface/transformers` and `onnxruntime-node` ship native
  binaries; the image will be on the order of gigabytes even pruned. That is a
  real cold-start cost on Fargate and Container Apps, and reinforces the
  min-replicas ≥ 1 guidance already in the Azure guide.
- **Publishing publicly** makes every alpha build pullable by anyone. The source
  is already public, so this exposes no new information, but it does mean the
  version history is permanently visible. Deleting a published tag is possible
  but not clean.
- **`latest` on an alpha product** can point at something unstable. Consider
  publishing `latest` only from the current release line, never from `main`.
