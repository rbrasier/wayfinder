# Summary — alpha-2 parity and a seamless alpha-2 upgrade (v0.41.0)

Source: release-readiness review before cutting alpha-3 (maintainer request). No
issue. `/release` Operation C, widened to the release-line features the v0.40.4
forward-merge left for alpha-3 to decide.
Version: 0.40.7 → 0.41.0 (MINOR — two migrations).

## Why

Two things stopped `main` being ready to cut as alpha-3:

1. **An alpha-2 database did not upgrade.** Drizzle applies only migrations whose
   journal timestamp is later than the newest one a database recorded. Alpha-2
   numbered its migrations independently after `0043`, and its last (`0051`) is
   newer than `main`'s `0044`–`0058`. Rehearsed on a real Postgres: `main`'s
   migrator applied **1** of 16 pending migrations to an alpha-2 database, leaving
   it without `app_sessions.mode`, `kb_lookup_sources` and the rest of alpha-3's
   schema.
2. **Two alpha-2 features were missing from `main`** (held back at v0.40.4 because
   they conflicted with `main`'s shape): the admin permission split (#349,
   ADR-066) with its escalation fix, and MCP OAuth client-credentials sign-in
   (#361). Upgrading would have removed both.

## What changed

### Upgrade path

- **`release-line-reconciliation.ts`** (adapters, `db/`). `runMigrations` calls it
  under the existing advisory lock, before drizzle. On a database whose ledger
  holds an alpha-2-only migration it, in one transaction:
  - runs `main`'s missing migrations in journal order;
  - records, without running, the six that alpha-2 ran under its own number and
    that are byte-identical (`0046`, `0049`, `0057`, `0058`, `0059`, `0061`);
  - copies alpha-2's `credential_encrypted` into `credential_ciphertext` after
    `0055`, then drops it. Both lines encrypt with `SettingsEncryptionService`, so
    nobody re-enters a bearer token;
  - renames alpha-2's `oauth_client_secret_encrypted` to `main`'s
    `oauth_client_secret_ciphertext` in place of running `0060`.

  On a fresh, main-only or pre-fork alpha-2 database it plans nothing, and drizzle
  behaves exactly as before.
- **One migration entry point.** `pnpm db:migrate` (used by `restart.sh` and CI's
  e2e job) now runs the API's migrate CLI, and so `runMigrations`, instead of
  `drizzle-kit migrate`. This closes the second entry point ADR-047 left open.
  The container, Lambda and `migrate-if-configured.sh` already used it.
- **Rehearsal** — `release-line-upgrade.rehearsal.test.ts`, run by
  `db:rehearse-upgrade` and `validate.sh` §29. It skips when no database is
  reachable. It migrates a throwaway database exactly as `release/alpha-2` left
  it, from `drizzle-fixtures/alpha-2`, and seeds a bearer-token server and an
  OAuth server. Then it upgrades the database and requires:
  - the same columns, indexes and constraints as a fresh database;
  - every `main` migration recorded;
  - both credentials carried across;
  - a second run to be a no-op.

  With the reconciliation switched off, it fails.

### Admin permission split (alpha-2 v0.28.46–47, ported)

- Cherry-picked from `release/alpha-2`, resolved onto `main`'s shape:
  - #349's planning docs and four build commits;
  - the server-side Global-only cards fix;
  - #366's custom-role escalation fix.
- Conflicts resolved:
  - REST routes take `main`'s `withPrincipal` principal, and `resolveCanOversee`
    reads it. Under "view as user" this checks the simulated user's areas, and
    the admin layout still refuses any simulated session (ADR-059 §3a).
  - Configuration is rebuilt from `main`'s page, which has the setup wizard,
    lookup sources, retention and Synthesise limits, with alpha-2's Global-only
    gating applied.
  - Zod 4 `.guid()` is kept throughout.
  - The `@rbrasier/*` scope becomes `@wayfinder/*`.
- `0061_global_admin_role_name.sql` is alpha-2's `0050`, byte for byte.

### Admin areas for `main`'s own surfaces

`admin-area-gates.test.ts` probes every `appRouter` procedure. It found 11 that
had no area, and they are now classified:

| Surface | Area | Why |
|---|---|---|
| Lookup sources (7 admin procedures; `search`/`match` stay open to operators) | Technical | A Configuration card |
| MCP tool listing, refresh and tool settings | Technical | Same screen as the rest of MCP servers |
| Embeddings "needs re-index" indicator | Technical | Drives the Configuration dot |
| Session policy, Sign out everywhere | Global | Access controls (ADR-035) |
| Data retention | Global | Scheduled deletion is a governance decision |
| View as user | Global | Acting with another user's access (ADR-059) |

Where `main`'s code used `isAdmin` to mean "may edit any flow", it now honours
`admin:oversight`, as ADR-066 §4 does for All Flows. That covers flow memory,
flow test runs, flow duplicate and export, Synthesise analysis and size checks,
and off-system approval evidence (session access). The Users screen disables
"Sign out everywhere" for a non-Global admin.

## Migrations

- `0060_mcp_oauth_client_credentials.sql`: six nullable columns. It is additive,
  so it carries no `-- data-impact:` line.
- `0061_global_admin_role_name.sql`: `-- data-impact: preserved — renames one
  role's display name; key, flags and grants are untouched`.

## Tests

- adapters:
  - `release-line-reconciliation.test.ts` (planner, constants against both
    journals, byte-identity of recorded pairs);
  - the rehearsal above.
- web:
  - `oversight-main-surfaces.test.ts` (flow memory, test run report, duplicate:
    oversight passes, Technical/User Admin does not);
  - an oversight case in `export/route.test.ts`;
  - classifications in `admin-area-gates.test.ts`.
- Every new test failed before its change.
- **E2E:** none new. The ported `phase-user-roles-permissions.spec.ts` and
  `fix-entra-admin-recovery.spec.ts` (groups 1 and 4) came across with the split
  and run in CI. The upgrade is covered by the rehearsal, not a browser.

## Known limitations

- The reconciliation knows alpha-2 by its journal timestamps. A migration added to
  `release/alpha-2` after this must be added there before it reaches `main` (see
  `managing-releases.md`, "Migrations on a release line").
- An alpha-2 server that still authenticated through an `MCP_CRED_*`
  environment variable loses that reference and needs its token entered once:
  `main`'s `0056` dropped it for every deployment (ADR-062 §8).
- Logo upload stays Global-only, while branding colours are Technical. This is
  unchanged from alpha-2.
- An alpha-3 image older than 0.41.0 still mis-migrates an alpha-2 database; the
  upgrade guide says to use 0.41.0 or later.

## Deviations

None from the review's recommendations. Retention and session policy were placed
in the Global area by judgement, because neither existed when ADR-066 was
written.
