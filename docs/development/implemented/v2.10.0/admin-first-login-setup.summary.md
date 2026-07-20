# Implementation Summary — Admin First-Login Setup (v2.10.0)

- **Version**: 2.10.0 (bump: **MINOR** — new admin feature; all config is runtime
  state in existing tables; no schema migration). Drafted as 2.9.0; bumped to
  2.10.0 because 2.9.0 shipped structured-conversation first.
- **PRD**: `docs/development/prd/admin-first-login-setup.prd.md`
- **ADR**: `docs/development/adr/041-first-run-onboarding-and-db-first-config.adr.md`
- **Phase**: `admin-first-login-setup.phase.md` (this folder)

## What was built

A zero-env first-run experience. On the very first load, before any sign-in, the
installer creates the admin account on a self-disabling bootstrap screen; the new
admin is then walked through a gated three-step setup wizard that reuses the
existing admin-settings cards to configure and test everything the app needs. All
configuration writes to the database; env values remain optional overrides.

- **In-app admin bootstrap** — a public `/setup` screen creates the first admin
  via Better Auth, defended in layers: a one-time **setup token** (persisted in a
  DB row, printed to the startup log), a **transactional advisory-lock singleton
  guard**, **seed-email binding** (`ADMIN_SEED_EMAIL`), IP **rate-limiting**, and
  an **audit** entry. The screen self-disables once an admin exists.
- **Startup setup link** — `instrumentation.ts` ensures the token and logs a
  clickable `${BETTER_AUTH_URL}/setup?token=…` line on boot while no admin
  exists (any launch method); silent once an admin exists.
- **Three-step setup wizard** (`components/onboarding/setup-wizard.tsx`) mounted
  in the admin layout, gated on `onboarding_state.completed`, re-openable from
  admin Settings ("Re-run setup"). It **reuses the existing settings cards**
  (`OrganisationNameCard`, `StorageCard`, `AiProviderCard`, `AuthMethodsCard`,
  `EmailCard`, `N8nIntegrationCard`) driven by the shared `useConnectivity`
  hook — no duplicated config/test UI. Step 2 warns (does not block); Finish and
  Skip both call `completeOnboarding`.
- **Automation flags default OFF** — `auto_node`, `skills`, `mcp` default off;
  `scheduled_node` stays on. `skills`/`mcp` are surfaced in admin UI via the code
  `DEFAULT_FEATURE_FLAGS` list and toggled on (via `featureFlag.upsert`) from the
  wizard's Step 3.
- **Zero-env start** — `restart.sh` seeds `.env` from `.env.example` and
  auto-generates both `SETTINGS_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`; the
  `.env.example` `DATABASE_URL` port is reconciled to the docker-compose host
  port (5433). Docs (`README.md`, `.env.example`, `setup-local.md`) lead with the
  zero-env path, env demoted to "advanced / optional overrides".

## Files created

- `packages/domain/src/ports/admin-bootstrap.ts` — `IAdminAccountCreator` port.
- `packages/domain/src/entities/setup-status.test.ts` — `is*Configured` helpers.
- `packages/application/src/use-cases/onboarding/{create-admin,onboarding-settings,setup-token}.ts` (+ tests, `index.ts`).
- `packages/adapters/src/auth/admin-account-creator.ts` — `BetterAuthAdminAccountCreator` (advisory-lock singleton guard + Better Auth sign-up + promote).
- `apps/web/src/server/routers/bootstrap.ts` — `adminExists` / `createAdmin`.
- `apps/web/src/app/setup/page.tsx` — public first-run screen.
- `apps/web/src/components/onboarding/setup-wizard.tsx` — the wizard.
- `apps/web/src/lib/container-onboarding.ts` — onboarding + organisation use-case cluster (keeps `container.ts` under the size ceiling).
- `apps/web/e2e/phase-admin-first-login-setup.spec.ts` — e2e.

## Files modified

- `packages/domain/src/entities/runtime-config.ts` — `OnboardingState`,
  `DeploymentConfig`, their keys, `SETUP_TOKEN_SETTING_KEY`, tolerant parsers, and
  `isStorageConfigured` / `isAiConfigured` / `isN8nConfigured` / `isEmailConfigured`.
- `packages/domain/src/ports/system-settings-repository.ts` — added `delete(key)`
  (+ the two repository implementations and the settings-repo test fakes).
- `packages/application/src/use-cases/get-feature-flag.ts` — `skills` + `mcp`
  added to `DEFAULT_FEATURE_FLAGS` (off).
- `apps/web/src/lib/{container.ts,env.ts,instrumentation.ts}` — wiring, `SETUP_TOKEN`
  env, startup link.
- `apps/web/src/server/routers/{router,settings}.ts` — bootstrap router registration;
  `getOnboardingState` / `completeOnboarding` / `get`/`setDeploymentConfig` /
  `getSetupStatus` procedures.
- `apps/web/src/app/(admin)/admin/layout.tsx`, `.../settings/page.tsx`,
  `apps/web/src/app/(auth)/login/page.tsx` — wizard mount, "Re-run setup", no-admin redirect.
- `restart.sh`, `.env.example`, `README.md`, `docs/guides/setup-local.md`.

## Migrations run

None (no DDL). New `admin_system_settings` rows only (`onboarding_state`,
`deployment_config`, `setup_token`). Two **existing** seed migrations were changed
to seed the automation flags **off** on fresh installs (Drizzle re-runs a
migration only on databases that never applied it, so this affects fresh installs
only): `0035_seed_mcp_skills_flags.sql` (`mcp`/`skills` → false) and
`0015_outstanding_ultimatum.sql` (`auto_node` → false, `DO UPDATE` → `DO NOTHING`).

## e2e tests added

- `apps/web/e2e/phase-admin-first-login-setup.spec.ts` — (1) re-run setup opens
  the three-step wizard and finishes; (2) `/setup` self-disables (redirects to
  `/login`) once an admin exists.
- `apps/web/e2e/fix-seed-mcp-skills-flags.spec.ts` — updated to assert the new
  default-off behaviour (Skills/MCP nav entries hidden until enabled).

Playwright e2e specs are excluded from the vitest unit run and are driven by the
`/e2e` (Playwright MCP) skill against a live signed-in stack.

## Known limitations / deviations

- **`getSetupStatus`** reports per-step **configured** state (env or DB); the
  wizard surfaces "complete" via each reused card's live Test button rather than
  persisting a tested flag (no onboarding table, per ADR-041).
- **`SETTINGS_ENCRYPTION_KEY` pre-flight** — the key is required at boot (env
  validation), so `encryptionKeyReady` is effectively always true at runtime; the
  wizard still carries the warning path defensively.
- **Step 1 org name** reuses the existing `OrganisationNameCard` (the canonical
  `organisation_name` setting) per the "reuse, don't duplicate" directive; the
  multi-org checkbox writes `deployment_config`. Sharing-scope organisation rows
  are managed from admin Settings → Organisations.
- `POWER_USER_SCOPED_FLAGS` already scoped `mcp`/`skills` in code; left as-is.

## Validation

`./validate.sh` — all 19 checks pass. `VERSION` and root `package.json` are `2.10.0`.
