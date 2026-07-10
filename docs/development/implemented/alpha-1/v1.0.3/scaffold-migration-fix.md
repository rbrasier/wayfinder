# Bug: Migrations silently skipped + OTel crash in scaffolded projects

## Root Causes

### 1. Migration silently skipped (`No projects matched the filters`)

`restart.sh` runs:
```bash
pnpm --filter "@rbrasier/adapters" db:migrate
```

`pnpm --filter` only matches **workspace packages**. In a scaffolded project,
`pnpm-workspace.yaml` lists only `apps/*`. `@rbrasier/adapters` is an npm
dependency, not a workspace member, so pnpm prints:

```
No projects matched the filters in "…/project"
```

…and exits 0. Migrations never run. The API starts against a bare database and
fails at runtime.

### 2. `drizzle/` migration SQL files absent from the published package

`packages/adapters/package.json` declares:

```json
"files": ["dist", "src"]
```

The `drizzle/` folder containing the generated SQL migration files is excluded.
Even if the correct migration command were used, the SQL files would not exist
inside the installed npm package.

### 3. `init-project-test.sh` always installs from npm

The test harness builds the `create` CLI from local source but the scaffold
still writes `"@rbrasier/adapters": "^1.0.0"` (the latest npm version) into
the scaffolded project. Any fix to the adapters package cannot be verified
locally without first publishing to npm. This breaks the develop → test cycle.

### 4. OTel crash (separate, already code-fixed)

The code fix (moving `@opentelemetry/*` from `peerDependencies` to
`dependencies` in adapters) was applied in a previous session but
`packages/adapters/package.json` version was never bumped. The published
`1.0.0` package still has the broken peer-dep declaration.

## Reproduction

```bash
./init-project-test.sh --keep
/tmp/create-ai-app-template-XXXX/project/restart.sh

# Output:
# → running pending migrations
# No projects matched the filters in "/tmp/…/project"
# → starting dev servers (Ctrl-C to stop)
# ERR_MODULE_NOT_FOUND: Cannot find package '@opentelemetry/exporter-trace-otlp-http'
```

## Fix Plan

### A. Export `runMigrations` from `@rbrasier/adapters/db`

Create `packages/adapters/src/db/migrate.ts`:

```typescript
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolves to packages/adapters/drizzle/ in the workspace and to
// node_modules/@rbrasier/adapters/drizzle/ in a scaffolded project —
// both contain the generated SQL migration files.
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  await client.end();
}
```

Export it from `packages/adapters/src/db/index.ts`.

### B. Add `drizzle` to `files` in `packages/adapters/package.json`

```json
"files": ["dist", "src", "drizzle"]
```

### C. Add `drizzle-orm` and `postgres` to `apps/api/package.json` dependencies

These are peerDependencies of adapters that the API uses at runtime. Adding
them as direct dependencies guarantees they are installed in scaffolded
projects regardless of pnpm peer-dep resolution strategy.

### D. Update `restart.sh`

In scaffolded mode (no `packages/adapters/package.json`), run migrations via
`runMigrations` instead of `pnpm --filter`:

```bash
node --input-type=module -e "
  import { runMigrations } from '${ADAPTERS_PKG}/db';
  await runMigrations(process.env.DATABASE_URL ?? '');
"
```

### E. Update `init-project-test.sh` to use local packs

Build framework packages, pack them into tarballs, and set `PACKS_DIR` so
the scaffold uses `file:` references instead of npm version ranges. This lets
every local code change be tested without publishing first.

### F. Update `packages/create/src/index.ts`

When `process.env.PACKS_DIR` is set (local test mode), write
`"file:/path/to/rbrasier-{pkg}-{version}.tgz"` instead of `"^{version}"`.

### G. Bump `packages/adapters` to `1.0.1` via changeset

All four framework packages are linked (`@rbrasier/domain`, `@rbrasier/shared`,
`@rbrasier/application`, `@rbrasier/adapters`) so they all bump to `1.0.1`.

## Version Bump

PATCH: root `1.0.2 → 1.0.3`; adapters (and linked packages) `1.0.0 → 1.0.1`.

## Implementation Summary

**Migrations silently skipped** — `pnpm --filter @rbrasier/adapters db:migrate`
finds no workspace package in scaffolded projects. Fixed by branching in
`restart.sh`: template mode keeps the `pnpm --filter` path; scaffolded mode
(no `packages/adapters/package.json`) calls
`node --input-type=module -e "import { runMigrations } from '…/db'; …"`.

**`runMigrations` added** (`packages/adapters/src/db/migrate.ts`): uses
`drizzle-orm/postgres-js/migrator` (no drizzle-kit required) and resolves
the `drizzle/` folder relative to `import.meta.url` — works both in the
workspace (`packages/adapters/dist/`) and in the published npm package
(`node_modules/@rbrasier/adapters/dist/`).

**`drizzle` added to `files`** in `packages/adapters/package.json` so the
generated SQL migration files are included in the published package.

**`drizzle-orm` and `postgres` added to `apps/api/package.json` dependencies**
to guarantee they are installed in scaffolded projects regardless of pnpm
peer-dep auto-install behaviour.

**OTel changeset created** (`.changeset/scaffold-migration-fix.md`):
bumps `@rbrasier/adapters` (and all linked packages) from `1.0.0 → 1.0.1`
combining the OTel deps fix (previous session) and the migration fix.

**Local testing fixed** (`init-project-test.sh`): builds all framework
packages, packs them into tarballs (`PACK_DIR`), and exports `PACKS_DIR`.
`packages/create/src/index.ts` uses `file:` references instead of npm
version ranges when `PACKS_DIR` is set, so every local code change can be
tested without publishing first.

**Regression guards added** to `validate.sh` (sections 18 and 19).
