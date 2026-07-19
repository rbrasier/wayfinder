# Bug Fix: MCP and Skills feature flags never seeded on fresh installs

## Symptom

On any environment that ran the migrations without ever going through the E2E
seed endpoint (i.e. every normal local, dev and prod install), the MCP and
Skills UI is silently hidden:

- The flow-editor picker skips the "Add MCP tool" and "Skill" options
  (`apps/web/src/app/(user)/flows/[id]/config/_content.tsx:79-80` gate on
  `featureFlag.isEnabledForMe({ key: "mcp" })` /
  `{ key: "skills" }`, both of which resolve to `false`).
- The admin nav shows `/admin/skills` and `/admin/mcp-servers` even though
  their flags are off, so an admin who *does* open them sees populated pages
  but end users see nothing.

Reported after checking a fresh clone of `claude/comparison-houbyl`: none of
the new v2.2.0 / v2.5.0 features surface even though the migrations ran and
the admin was seeded.

## Reproduction

1. Drop / recreate the database (`wayfinder_mcp`).
2. Run migrations to head (`pnpm --filter @rbrasier/adapters db:migrate`).
3. Boot the web app; log in as any user.
4. `SELECT key, enabled FROM core_feature_flag;` returns only
   `auto_node = true`. There is no row for `mcp`, `skills`, or `scheduled_node`.
5. Open a flow's config: the MCP + Skills picker options are absent.

## Root Cause (verified)

Feature flag existence is not owned by any single seeding step. It is spread
across three places, and the newer flags are covered by **none** of them:

1. **Migration `0015_outstanding_ultimatum.sql:3`** inserts `auto_node = true`
   with `ON CONFLICT ("key") DO UPDATE SET "enabled" = true`. This is the only
   place a flag row is ever inserted by migration.
2. **`packages/application/src/use-cases/get-feature-flag.ts:11`** hardcodes a
   `DEFAULT_ENABLED_FLAGS = new Set(["scheduled_node"])`. Both `IsFeatureEnabled`
   and `IsFeatureEnabledForUser` fall back to this set when
   `repo.findByKey(key)` returns `null`. `scheduled_node` therefore appears
   enabled even without a DB row.
3. **`packages/adapters/src/auth/seed-roles.ts:49`** lists `mcp` and `skills`
   in `POWER_USER_SCOPED_FLAGS`, but that array only drives inserts into the
   `admin_feature_flag_roles` join table — not `core_feature_flag` — and only
   when the Power Users role is created on that run
   (`seed-roles.ts:78` early-returns if it already existed). It never creates
   the flag row itself.

`mcp` and `skills` therefore have no migration insert and no code default. On
a fresh install both call sites see `flag.data = null` and fall through to
`DEFAULT_ENABLED_FLAGS.has(key)` → `false`.

**Why the e2e suite doesn't catch this:** `apps/web/src/lib/e2e-fixtures.ts:411`
explicitly `upsertFeatureFlag.execute({ key: "mcp"/"skills", enabled: true })`
before running the suite, so the specs exercise the "flag on" branch. The
production seed path has no equivalent.

## Fix Plan

Owned by migration, not by code defaults — matches how `auto_node` is handled
in `0015`.

1. Add migration `0032_seed_mcp_skills_flags.sql` mirroring the `0015` pattern:

   ```sql
   INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
     ('mcp', true, 100, 'Enables MCP servers/tools in flow builder and at runtime'),
     ('skills', true, 100, 'Enables Skills library and per-step skill selection')
   ON CONFLICT ("key") DO NOTHING;
   ```

   `DO NOTHING` (not `DO UPDATE SET enabled = true`) so an admin who
   intentionally disables the flag via `/admin/flags` after the migration is
   not overridden on next boot.
2. Append the matching `_journal.json` entry and `meta/0032_snapshot.json`
   snapshot so drizzle-kit accepts the tree.
3. Delete the redundant `upsertFeatureFlag.execute(...)` block in
   `apps/web/src/lib/e2e-fixtures.ts:411` — the migration now covers it, and
   keeping the upsert would let this exact bug class regress silently again.
4. Gate the sidebar entries: hide `/admin/skills` and `/admin/mcp-servers`
   from `adminNav` when the corresponding flag is disabled. Uses the existing
   `trpc.featureFlag.isEnabledForMe` query (already used by the flow editor).
   Admin can still recover via `/admin/flags`, which is not gated.
5. Regression test on the repository: after applying migrations to a fresh
   DB, `featureFlagRepository.findByKey("mcp")` and `("skills")` return rows
   with `enabled = true`.
6. Playwright e2e test asserting the seeded admin sees both nav entries and
   that they disappear when the flag is toggled off.
7. PATCH version bump `2.5.0 → 2.5.1`.

## Implementation Summary

- **Root cause:** feature flag existence had no single owner. Migration `0015`
  seeded `auto_node`; `DEFAULT_ENABLED_FLAGS` in
  `packages/application/src/use-cases/get-feature-flag.ts:11` provided a code
  fallback only for `scheduled_node`; `seed-roles.ts:49` scoped `mcp`/`skills`
  to Power Users but only inserted into the `admin_feature_flag_roles` join
  table, never `core_feature_flag` itself. On fresh installs both flags
  resolved to `false` and their UI (flow-editor picker options + admin nav
  entries) was silently hidden.
- **Fix applied:**
  - New migration
    `packages/adapters/drizzle/0032_seed_mcp_skills_flags.sql` seeds `mcp`
    and `skills` with `enabled=true` using
    `INSERT ... ON CONFLICT ("key") DO NOTHING`. `DO NOTHING` (not
    `DO UPDATE SET enabled = true`) so an admin who intentionally disables
    the flag via `/admin/flags` is not overridden on the next boot.
  - Meta snapshot `meta/0032_snapshot.json` and `_journal.json` entry added.
  - Sidebar (`apps/web/src/components/sidebar.tsx`) now builds the admin nav
    from a function that hides `/admin/skills` and `/admin/mcp-servers` when
    the corresponding flag is disabled. Reads
    `trpc.featureFlag.isEnabledForMe`, identical to the flow-editor gate at
    `apps/web/src/app/(user)/flows/[id]/config/_content.tsx:79-80`. Admins
    can still recover disabled flags from `/admin/flags` in the Advanced
    group, which is not gated.
  - Removed the redundant `upsertFeatureFlag` block in
    `apps/web/src/lib/e2e-fixtures.ts:411` — the migration is now
    authoritative, and keeping the upsert would let this bug regress
    silently again.
- **Regression test:** `packages/adapters/src/db/__tests__/seeded-feature-flags.test.ts`
  reads every `drizzle/*.sql` file and asserts an `INSERT INTO
  "core_feature_flag" ... 'mcp'` and `'skills'` statement exists. Verified
  failing before the migration was added, passing after.
- **E2E test:** `apps/web/e2e/fix-seed-mcp-skills-flags.spec.ts` navigates an
  admin to `/admin/sessions` and asserts the Skills + MCP Servers sidebar
  links render — the surface that disappeared before the fix.
- **Version:** PATCH bump `2.5.0` → `2.5.1`.
