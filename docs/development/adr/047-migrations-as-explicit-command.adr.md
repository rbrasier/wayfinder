# ADR-047 — Migrations Are an Explicit Command, Not a Web-Boot Side Effect

- **Status**: Proposed (scoped by `container-distribution.prd.md`)
- **Date**: 2026-08-04
- **Builds on**: ADR-046 (the container image — the deployment shape that makes
  this necessary), ADR-041 (first-run wizard — the zero-config local promise this
  must not break)

## Context

The web app migrates the database as part of starting:

```
"start": "../../scripts/with-root-env.sh sh -c '../../scripts/migrate-if-configured.sh && exec next start -p ${WEB_PORT:-3000}'"
```

`migrate-if-configured.sh` runs `pnpm --filter @wayfinder/adapters db:migrate`,
which is `drizzle-kit migrate`.

This is a good default for a single machine, and it is why `./restart.sh` works
from a clean checkout with no database step — a property ADR-041 deliberately
built for and which must not regress.

It causes three problems everywhere else:

1. **`drizzle-kit` is a devDependency** of `@wayfinder/adapters`. Because the
   production start path invokes it, a production image cannot prune dev
   dependencies without failing on boot. Both cloud guides carry an explicit
   "do not prune dev dependencies" warning as a result.
2. **Concurrent migration on rollout.** With more than one web instance, a
   rolling deploy starts several containers that each try to migrate. Both cloud
   guides work around it by telling the operator to run migrations as a separate
   one-off task first — advice that exists only because the default is wrong for
   that shape.
3. **Migration failures present as a crash-looping web container**, where the
   real error is buried in application startup logs, rather than as a failed
   migration step with an exit code.

The machinery to fix this already exists and is unused by the start path.
`packages/adapters/src/db/migrate.ts` exports:

```typescript
export async function runMigrations(databaseUrl: string): Promise<void>
```

built on `drizzle-orm/postgres-js/migrator` and `postgres` — both **runtime**
dependencies — resolving the migrations folder in both the workspace and the
published-package layouts.

So the runtime need for `drizzle-kit` is incidental: it comes from routing
through the `db:migrate` npm script, not from anything migrations require.

## Decision

### 1. A `migrate` entrypoint built on `runMigrations`

Add a thin CLI in `packages/adapters` that reads `DATABASE_URL`, calls
`runMigrations`, and exits `0` on success or non-zero with the error on failure.
It depends only on `drizzle-orm` and `postgres`, both already runtime
dependencies.

The container image exposes it as a command, so a deployment runs migrations as
a discrete step — an ECS one-off task, a Container Apps job, a compose
`depends_on` — that either succeeds or fails visibly.

`drizzle-kit` stays where it belongs: generating and checking migrations during
development (`db:generate`, `db:check`), never at runtime.

### 2. Start-time migration becomes a flag, defaulting to on

The web `start` script keeps migrating **by default**, so `./restart.sh` and
`pnpm dev` behave exactly as they do today. A new environment variable opts out:

| `RUN_MIGRATIONS_ON_START` | Behaviour |
| --- | --- |
| unset or `true` (default) | Migrate before starting — today's behaviour |
| `false` | Start immediately; migrations are someone else's job |

Production images set it to `false`; the compose file and every cloud guide run
the `migrate` command as their own step.

**The default is deliberately the local-developer default, not the production
one.** ADR-041's promise is that a clean checkout runs with no configuration; a
default of `false` would break that for every contributor to benefit
deployments, which are the smaller and more expert audience. Deployments already
set a dozen environment variables — one more is free. Contributors set none.

### 3. The start path stops invoking `drizzle-kit`

`migrate-if-configured.sh` is rewritten to call the §1 entrypoint rather than
`pnpm --filter @wayfinder/adapters db:migrate`. It keeps its existing behaviour of
skipping silently when `DATABASE_URL` is unset — CI lint and typecheck
containers depend on that — and gains the `RUN_MIGRATIONS_ON_START` check.

After this, no runtime path reaches `drizzle-kit`, which is what unblocks
pruning dev dependencies from the production image.

**Pruning is a consequence, not a promise.** Whether `pnpm prune --prod` yields
a working image also depends on the workspace's peer-dependency resolution
(the framework libraries are `peerDependencies` of `@wayfinder/adapters` but real
`dependencies` of `apps/web` and `apps/api`). That must be verified by building
and running, not assumed. This ADR stands on its multi-instance and
observability merits regardless of how pruning turns out.

### 4. Migrations stay forward-only and are not run concurrently by design

This ADR does not add advisory locking. Drizzle's migrator tracks applied
migrations in its own table, but the fix for concurrent rollout is to run
migrations **once, as a step**, not to make concurrent invocation safe. The
guidance in both cloud guides becomes the supported path rather than a
workaround.

If a future deployment shape genuinely cannot serialise the step, a Postgres
advisory lock inside `runMigrations` is the obvious follow-up — deliberately not
taken here, because adding a lock would suggest concurrent migration is a
supported pattern.

## Alternatives considered

- **Move `drizzle-kit` to a runtime dependency of `@wayfinder/adapters`.**
  Rejected: it makes the pruning problem permanent and ships a development tool
  and its dependency tree into every production image, to avoid writing a
  twelve-line CLI over a function that already exists.
- **Remove start-time migration entirely.** Rejected: it breaks ADR-041's
  zero-config local run, and would mean every contributor learns a database step
  that exists only for deployments.
- **Default `RUN_MIGRATIONS_ON_START` to `false` and have `restart.sh` set it
  true.** Rejected as strictly worse: identical outcome for both audiences, but a
  contributor running `pnpm dev` directly — without `restart.sh` — silently gets
  an unmigrated database and a confusing failure.
- **Advisory lock inside `runMigrations` so concurrent boots are safe.**
  Rejected for now: it legitimises concurrent migration rather than fixing the
  deployment shape, and the explicit step is what both cloud guides already
  recommend. Noted as a follow-up if a platform forces it.
- **A dedicated init container / sidecar pattern in the image.** Rejected as
  premature: it is a Kubernetes idiom, and no Kubernetes support is in scope. The
  `migrate` command composes into that pattern later if needed.

## Consequences

**Positive**

- No runtime path reaches `drizzle-kit`, which unblocks pruning dev dependencies
  from the production image.
- Migration failures surface as a failed step with an exit code, not as a
  crash-looping web container.
- Multi-instance rollouts stop racing, and the guides' one-off-task advice
  becomes the supported default rather than a workaround.
- `./restart.sh`, `pnpm dev` and the local developer experience are unchanged.
- Uses machinery that already exists and is already exercised by the published-
  package layout.

**Negative**

- One more environment variable in an already large surface, and one whose
  correct production value (`false`) is the opposite of its default. It must be
  set in the image, the compose file and both cloud guides, or a deployment
  silently keeps migrating on boot — the exact behaviour this ADR moves away
  from. This is the main thing to get right in review.
- A deployment that forgets the `migrate` step now starts against an unmigrated
  database and fails at first query rather than migrating itself. The failure is
  loud, but it is a new way to get a deployment wrong.
- A second migration entry point exists during the transition — the new CLI and
  the `db:migrate` script — until the latter is confirmed to be development-only.
- `migrate-if-configured.sh` gains a second responsibility (the flag check)
  alongside its existing `DATABASE_URL` guard.
