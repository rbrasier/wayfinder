# Implementation Summary — Container Distribution and Release Artifacts

- **Version**: 0.24.0 (**MINOR** — new build, CI and release capability; no
  schema change, no behaviour change for an existing install)
- **Phase doc**: [`container-distribution.phase.md`](./container-distribution.phase.md)
- **PRD**: `docs/development/prd/container-distribution.prd.md`
- **ADRs**: ADR-046 (container image as the distribution unit), ADR-047
  (migrations as an explicit command)

---

## What was built

Wayfinder is now distributed as a container image rather than a monorepo
checkout. One image contains both processes; the runtime command selects `web`,
`api` or `migrate`. CI builds it on every pull request, and a `v*` tag publishes
it to GHCR.

Migrations became a discrete, re-runnable command with a Postgres advisory lock,
and the upgrade path for every deployment shape is documented in one place.

---

## Three real bugs found by building the thing

The phase was scoped around a finding that nothing in CI ran `pnpm build`.
Building the image proved that finding out three times over. **None of these were
in the phase doc, because none of them were discoverable without a build.**

### 1. `apps/api`'s production start script had never worked

`"start": "node dist/index.js"` — but `tsc` emitted a `dist/` whose imports
resolve into `packages/adapters/src/index.ts`, TypeScript source with
extensionless relative imports. Node cannot load it:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '/home/user/wayfinder/packages/adapters/src/db/index'
  imported from /home/user/wayfinder/packages/adapters/src/index.ts
```

Nothing in the repository ran it — `turbo dev` uses `tsx watch`, and CI never
built. The API had no working production entry point at all.

**Fix:** `apps/api/build` is now an esbuild bundle
(`apps/api/esbuild.config.mjs`) that inlines the workspace packages and leaves
only genuinely native modules external.

### 2. `apps/api` under-declared its dependencies

Bundling surfaced a second layer: `apps/api` imports the `@rbrasier/adapters`
barrel, which needs `ai`, `better-auth`, `@langchain/*` and `langfuse` — none of
which `apps/api` declared. In the workspace these resolve through
`packages/adapters/node_modules`; from `apps/api/dist` they do not resolve at
all.

**Fix:** everything pure-JS is inlined into the bundle. The two genuinely native
packages the API needs at runtime — `@huggingface/transformers` and `pdf-parse`
— are now declared dependencies of `apps/api`, which they always were in
practice.

### 3. `runMigrations` pointed at a folder that does not exist

```typescript
join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle")
```

From `packages/adapters/src/db/migrate.ts` that resolves to
`packages/adapters/src/drizzle`. The migrations are in
`packages/adapters/drizzle`. It had never worked in the workspace layout.
`restart.sh` only reached it in scaffolded mode, where it imported
`@rbrasier/adapters/db` — a subpath that was **not in the package's `exports`
map** either.

**Fix:** `resolveMigrationsFolder` tries an ordered candidate list and accepts a
`MIGRATIONS_DIR` override, throwing an error that names every path it tried.
`./db` was added to the adapters `exports` map.

---

## Graceful migrations

Beyond the phase doc: migrations had to apply gracefully with a simple upgrade
path. ADR-047 had explicitly deferred advisory locking; that deferral was
reversed, because "graceful" and "races on rolling deploy" cannot both be true.

`runMigrations` now:

- **Serialises on a Postgres advisory lock.** Concurrent invocations wait rather
  than race, and report that they are waiting.
- **Reports what it did** — how many migrations applied, how many were already
  applied, how long it took.
- **Surfaces the cause of failure.** The driver reports `Failed query: …` and
  buries `connect ECONNREFUSED` in `error.cause`; the CLI prints the cause,
  which is the entire diagnostic value to an operator.
- **Filters Postgres's benign duplicate-object notices** (`42P06`, `42P07`),
  which drizzle emits on every run after the first.

Verified against a real Postgres 16:

| Test | Result |
|---|---|
| Empty database | `Applied 42 migration(s) in 640ms` — exit 0 |
| Run again | `Database is already up to date — 42 migration(s) applied previously` — exit 0 |
| **3 concurrent processes, fresh database** | One applied 42; two reported waiting, then no-op. **42 rows recorded, not 126.** All exit 0 |
| Unreachable database | exit 1, `Caused by: connect ECONNREFUSED 127.0.0.1:5999` |
| No `DATABASE_URL` | exit 1 with a clear message |

`RUN_MIGRATIONS_ON_START` defaults to `true`, preserving ADR-041's zero-config
local promise, and every deployment artifact sets it to `false`.

---

## Files created

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build; one image, three commands |
| `.dockerignore` | Excludes `.env`, build output, git and docs |
| `docker-entrypoint.sh` | Maps `web` / `api` / `migrate` to commands; anything else runs verbatim |
| `docker-compose.prod.yml` | Whole stack on one host, with migrations as their own service |
| `apps/api/esbuild.config.mjs` | Bundles the API and the migrate CLI |
| `apps/api/src/cli/migrate.ts` | The migrate entrypoint |
| `packages/adapters/src/db/migrate.test.ts` | Tests, written before the implementation |
| `.github/workflows/publish.yml` | Tag-triggered publish to GHCR |
| `.claude/commands/publish.md` | The `/publish` skill |
| `docs/guides/upgrading.md` | The upgrade path for every deployment shape |
| `apps/web/e2e/phase-container-distribution.spec.ts` | e2e coverage |

## Files modified

| File | Change |
|---|---|
| `packages/adapters/src/db/migrate.ts` | Advisory lock, reporting, folder resolution, notice filtering |
| `packages/adapters/package.json` | Added the `./db` subpath export |
| `apps/api/package.json` | esbuild build, `migrate` script, two missing runtime deps |
| `scripts/migrate-if-configured.sh` | Calls the new CLI; honours `RUN_MIGRATIONS_ON_START`; no longer invokes `drizzle-kit` |
| `.github/workflows/ci.yml` | `docker-image` and `compose-smoke` jobs |
| `.claude/commands/release.md` | Hands off to `/publish` after tagging (A and B) |
| `CLAUDE.md`, `docs/guides/skills.md` | `/publish` in the routing tables |
| `docs/guides/setup-aws.md`, `setup-azure.md` | §2 replaced with the image reference; migration guidance; troubleshooting |
| `docs/guides/setup-railway.md` | Minimal env set; `/setup` first-login flow |
| `README.md`, `docs/guides/setup-local.md`, `managing-releases.md` | Compose path, publishing, upgrade pointers |
| `.env.example` | `RUN_MIGRATIONS_ON_START`, `MIGRATIONS_DIR` |
| `VERSION`, `package.json` | 0.23.2 → 0.24.0 |

---

## Migrations run

**None.** This phase adds no schema change. The `migrate` entrypoint runs the
existing 42 generated migrations through the existing helper;
`packages/adapters/drizzle/` is untouched.

---

## Known limitations

- **The image was never built in this environment.** The session's HTTP proxy
  returns 403 for Docker Hub's blob CDN (`production.cloudfront.docker.com`), so
  no base image could be pulled and `docker build` could not run. The Dockerfile,
  entrypoint and compose file are unexercised; `docker compose config` validates
  the compose file, and that is the extent of it. **The CI `docker-image` and
  `compose-smoke` jobs are the first real test** — which is precisely why they
  were added. Expect to iterate on the PR.
- **`pnpm prune --prod` was not attempted.** ADR-047 unblocked it by removing
  `drizzle-kit` from the runtime path, but proving it needs a working image
  build. The Dockerfile carries a comment saying so. Image size is the cost.
- **Image size is unmeasured**, for the same reason. It will be large —
  `onnxruntime-node` and `@huggingface/transformers` dominate.
- **The advisory lock does not cover a process killed mid-migration.** The lock
  releases when the session ends, so the next run proceeds — but a migration
  interrupted half-way is still a database in an unknown state. Drizzle
  migrations are not transactional across files.
- **Single-architecture.** `amd64` only; Graviton and Azure Ampere need
  `buildx` multi-arch, deferred.
- **Published images are unsigned.** Cosign and SBOM are follow-ups.
- **npm publishing remains dormant.** `/publish` is shaped for two streams and
  only ships one.
- **The guides name `0.24.0` as the image tag.** Nothing publishes it until this
  version is tagged, so those references are forward-looking until the first
  `/publish` run.

---

## e2e tests added

`apps/web/e2e/phase-container-distribution.spec.ts` covers the phase's one
user-visible contract — that a running instance reports the version it was built
from:

- **Happy path:** the About modal shows `Version <VERSION file contents>`,
  proving `next.config.ts`'s build-time inlining of `NEXT_PUBLIC_APP_VERSION`
  survives into the running app. This is what makes a published image
  version-stamped.
- **Error path:** the modal never shows the `unknown` fallback, which is what
  renders when the inlining breaks — a build that still starts and serves pages,
  so nothing else in the suite would catch it.

Not run locally. CI runs the e2e suite on the pull request.

---

## Validation

`./validate.sh` passes — all 21 checks, with two pre-existing WARNs (no AI
provider key configured; four files at or above 700 lines, none of them touched
by this phase).

Check 8 (doc lifecycle) initially failed, catching the exact contradiction
flagged as a WARN during `/doc-review`: the scaling-with-new-infrastructure phase
doc described "Dockerfiles" plural and "two containers", contradicting ADR-046's
one-image decision. That doc now records the Dockerfile half as shipped in
v0.24.0 and states the one-image topology.
