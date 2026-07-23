# Bug Fix: extraction_flows feature flag never seeded — Synthesise menu hidden

## Symptom

The extraction-flows feature ("Synthesise Information") is invisible on every
normal install:

- The **Synthesise Information** nav entry never renders on either the user or
  admin sidebar. Both are gated on
  `trpc.featureFlag.isEnabledForMe({ key: "extraction_flows" })`
  (`apps/web/src/components/sidebar.tsx:254`), which resolves to `false`.
- `extraction_flows` never appears in the `/admin/flags` list, so an admin has
  no row to toggle it on — the feature is unreachable without hand-editing the
  database.

Severity: minor (unreleased feature; no data at risk). Affects the alpha-2
extraction-flows work (v2.12.0–v2.14.0), which is still dark-launched.

## Reproduction

1. Drop / recreate the database.
2. Run migrations to head (`pnpm --filter @rbrasier/adapters db:migrate`).
3. Boot the web app; sign in as any user (including an admin).
4. `SELECT key FROM core_feature_flag;` returns no `extraction_flows` row.
5. The sidebar shows no "Synthesise Information" entry, and `/admin/flags`
   lists no `extraction_flows` flag to enable.

## Root Cause (verified)

Identical bug class to the MCP/Skills seed miss fixed in v2.5.1
(`docs/development/implemented/alpha-2/v2.5.1/fix-seed-mcp-skills-feature-flags.md`).
Feature-flag existence has no single owner, and `extraction_flows` is covered
by none of the three mechanisms:

1. **No migration insert.** The extraction-flows migrations (`0037`, `0038`)
   add schema only; no migration ever inserts an `extraction_flows` row into
   `core_feature_flag`. `0035_seed_mcp_skills_flags.sql` seeds only `mcp` and
   `skills`.
2. **No code default.** `packages/application/src/use-cases/get-feature-flag.ts:11`
   hardcodes `DEFAULT_ENABLED_FLAGS = new Set(["scheduled_node"])` and
   `DEFAULT_FEATURE_FLAGS` containing only `scheduled_node`. So on a missing
   row, `IsFeatureEnabledForUser` falls through to `false` (hiding the menu),
   and `ListFeatureFlags` never surfaces the key on `/admin/flags`.
3. **Role scoping is not flag creation.** `seed-roles.ts:61` lists
   `extraction_flows` in `POWER_USER_SCOPED_FLAGS`, but that array only writes
   the `admin_feature_flag_roles` join table when the Power Users role is first
   created — it never inserts the `core_feature_flag` row itself.

With `flag.data = null`, `IsFeatureEnabledForUser` returns
`DEFAULT_ENABLED_FLAGS.has("extraction_flows")` → `false`, and
`ListFeatureFlags` returns no matching row.

## Fix Plan

Owned by migration, mirroring how `mcp`/`skills` are seeded in `0035` and
`auto_node` in `0015`.

1. Add migration `0039_seed_extraction_flows_flag.sql`:

   ```sql
   INSERT INTO "core_feature_flag" ("key", "enabled", "rollout_pct", "description") VALUES
     ('extraction_flows', true, 100, 'Enables the Synthesise Information extraction-flows surface')
   ON CONFLICT ("key") DO NOTHING;
   ```

   `DO NOTHING` (not `DO UPDATE SET enabled = true`) so an admin who
   intentionally disables the flag on `/admin/flags` is not overridden on the
   next boot.
2. Append the `_journal.json` entry and copy the `meta/0038` snapshot to
   `meta/0039` (seed-only migration ⇒ schema unchanged; new `id`, `prevId`
   chains to `0038`).
3. **Keep** `extraction_flows` in `POWER_USER_SCOPED_FLAGS`
   (`seed-roles.ts`) — the flag is enabled for everyone the scope allows:
   Power Users hold it directly and admins via the wildcard (ADR-021). This
   preserves the ADR-033 §7 role scoping while making the feature discoverable
   and switchable.
4. Regression test: extend
   `packages/adapters/src/db/__tests__/seeded-feature-flags.test.ts` to assert
   a migration seeds `extraction_flows`. Fails before the migration, passes
   after.
5. Playwright e2e: an admin sees the "Synthesise Information" nav entry.
6. PATCH bump `2.14.0 → 2.14.1`.

## Implementation Summary

- **Root cause:** `extraction_flows` had no `core_feature_flag` row seeded by
  any migration and no code default (`DEFAULT_ENABLED_FLAGS` /
  `DEFAULT_FEATURE_FLAGS` cover only `scheduled_node`). On every install the
  flag resolved to `null` → `IsFeatureEnabledForUser` returned `false` (hiding
  the "Synthesise Information" nav entry on both sidebars) and
  `ListFeatureFlags` never surfaced the key, so `/admin/flags` had no row to
  toggle. Same bug class as the MCP/Skills seed miss (v2.5.1).
- **Fix applied:**
  - New migration
    `packages/adapters/drizzle/0039_seed_extraction_flows_flag.sql` seeds
    `extraction_flows` with `enabled=true, rollout_pct=100` using
    `INSERT ... ON CONFLICT ("key") DO NOTHING`. `DO NOTHING` so an admin who
    later disables the flag via `/admin/flags` is not overridden on next boot.
    The seeded row makes the flag appear in the Flags list and resolve enabled.
  - `meta/0039_snapshot.json` (copied from `0038` — seed-only migration, schema
    unchanged, new `id`, `prevId` chained to `0038`) and the `_journal.json`
    entry added.
  - `POWER_USER_SCOPED_FLAGS` in `seed-roles.ts` left unchanged: the flag stays
    scoped to Power Users, who hold it directly, while admins hold it via the
    wildcard (ADR-021). Preserves the ADR-033 §7 role scoping while making the
    feature discoverable and switchable.
- **Regression test:** extended
  `packages/adapters/src/db/__tests__/seeded-feature-flags.test.ts` to assert a
  migration seeds `extraction_flows`. Verified failing before the migration was
  added, passing after.
- **E2E test:** `apps/web/e2e/fix-extraction-flows-flag.spec.ts` asserts a
  seeded admin sees the "Synthesise Information" nav entry and that
  `extraction_flows` is listed on `/admin/flags` — the surfaces that were
  hidden before the fix.
- **Validation:** `./validate.sh` — all 19 checks pass.
- **Version:** PATCH bump `2.14.0` → `2.14.1`.
</content>
</invoke>
