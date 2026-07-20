# Phase — Admin First-Login Setup

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.9.0 — **MINOR** (new admin feature; all config is runtime
  state in existing tables; no schema migration).
- **PRD**: `docs/development/prd/admin-first-login-setup.prd.md`
- **ADR**: `docs/development/adr/041-first-run-onboarding-and-db-first-config.adr.md`
- **Depends on**: ADR-025 (runtime auth config), ADR-038 (organisations as sharing
  scope), ADR-022 (feature-flag defaults), existing settings-encryption-at-rest.

## 1. Goal

A first-run experience that (a) on the very first load, **before any sign-in**,
lets the installer create the admin account on a self-disabling bootstrap screen,
then (b) walks that admin through a gated three-step setup modal that configures —
and tests — everything the app needs, writing to the database. Env-provided values
are detected and shown pre-filled/complete. Finishing or skipping marks setup
complete; the wizard is re-openable from admin Settings. `auto_node`, `skills`,
and `mcp` feature flags default off.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/runtime-config.ts` | Add `OnboardingState` + `DeploymentConfig` types, their `*_SETTING_KEY` consts, and tolerant `parse*` helpers (mirror `parseSiemConfig`). Keys are **not** sensitive. Tests first. |
| application | `use-cases/onboarding/create-admin.ts` | `CreateFirstAdmin` use-case: creates the admin via the user repo + auth adapter **only when no admin exists** (guard inside the operation). Tests: creates on empty install, refuses when an admin already exists. |
| application | `use-cases/onboarding/*.ts` | `AdminExists`, `GetOnboardingState`, `CompleteOnboarding`, `Get/SetDeploymentConfig`, and a `GetSetupStatus` that reports per-step configured/tested state (env or DB). Tests first. |
| adapters | `auth/seed-admin.ts` | Keep `seedAdmin` (promotion via `ADMIN_SEED_EMAIL`) as a fallback; no behavioural change required. |
| application | `use-cases/get-feature-flag.ts` | Add `skills` + `mcp` to the default flag list, **off**; confirm `auto_node` is absent from `DEFAULT_ENABLED_FLAGS` (stays off). |
| adapters | `auth/seed-roles.ts` | Keep `auto_node` role-scoping intent; extend `POWER_USER_SCOPED_FLAGS` only if Skills/MCP should be power-user scoped (confirm at Build — default: leave unscoped). |
| apps/web | `server/routers/bootstrap.ts` (new) | `adminExists` (publicProcedure read) + `createAdmin` (publicProcedure). Defence in layers: requires the one-time **setup token**, **transactional singleton guard** (advisory lock or partial unique index) so it **refuses/loses the race when an admin exists**, seed-email binding when `ADMIN_SEED_EMAIL` is set, rate-limited, and audit-logged. Signs the new admin in on success. |
| application/adapters | setup-token bootstrap | On boot with no admin, ensure a setup token: read `SETUP_TOKEN` env override, else read/create the `setup_token` row in `admin_system_settings` (non-sensitive; created only while no admin exists). Voided (row deleted) by `createAdmin` on success. Persisting in the DB (not `.env`) makes it portable across dev/prod/containers and restart-stable. |
| apps/web | `instrumentation.ts` | In the server-boot `register` hook, if no admin exists, ensure the token and `console.log` a clickable `${BETTER_AUTH_URL}/setup?token=<token>` line; log nothing once an admin exists. This is the single, launch-method-agnostic emitter (covers `pnpm dev`, `pnpm start`, `node`, containers). |
| root | `restart.sh` | Auto-generate `BETTER_AUTH_SECRET` alongside `SETTINGS_ENCRYPTION_KEY` (same generate-if-blank block) so a fresh clone needs no hand-edited env. No link logic here — the app emits it. |
| root | `README.md`, `.env.example`, `docs/guides/*getting-started*` | Refocus on the zero-env quick-start (§7); demote env config to an "advanced / optional overrides" section. `.env.example` reframed so every integration var reads as an optional override, not a prerequisite. |
| apps/web | `app/setup/page.tsx` (new) | Public first-run screen: setup token (pre-filled from the `?token=` query param) + email (pre-filled from `ADMIN_SEED_EMAIL` if set) + password + confirm. Only reachable while `adminExists` is false; redirects to sign-in/app otherwise. |
| apps/web | middleware / entry redirect | On an install with no admin, route unauthenticated first load to `/setup`. |
| apps/web | `server/routers/settings.ts` | Add `getOnboardingState` (adminProcedure), `completeOnboarding`, `get/setDeploymentConfig`, and `getSetupStatus` (per-step configured/tested). Reuse existing `set*Config`, `testConnectivity`, `testAllConnectivity`, `sendTestEmail`. |
| apps/web | `components/onboarding/setup-wizard.tsx` (new) | Stepped modal: Step 1 deployment, Step 2 setup (required, warn-not-block), Step 3 site options (skippable). Per-item explainer + Test button; steps pre-filled and marked complete from `getSetupStatus`. |
| apps/web | `app/(admin)/admin/layout.tsx` | Mount the wizard; open when `onboarding_state.completed` is false. |
| apps/web | `app/(admin)/admin/settings` | "Re-run setup" control that opens the wizard without clearing the flag. |
| root | `VERSION`, `package.json` | Bump to `2.9.0`. |

## 3. Database changes

- **None (no DDL).** Admin → new `core_users` row via existing auth adapter. New
  `admin_system_settings` rows only: `onboarding_state`, `deployment_config`,
  `setup_token`. Org name → existing `organisation.create` (`core_organisations`).
  Multi-org → existing `organisation_resolution`. `skills` / `mcp` → existing
  `core_feature_flag` (rows on first toggle).

## 4. Implementation order (tests first)

1. Domain: `OnboardingState` + `DeploymentConfig` types, keys, tolerant parsers
   — unit tests for malformed rows falling back to safe defaults.
2. `CreateFirstAdmin` + `AdminExists` use-cases — tests: creates on empty install,
   **refuses when an admin already exists**, **rejects a missing/wrong setup
   token**, honours seed-email binding, and cannot be raced into two admins
   (the security-critical guards).
3. Setup-token bootstrap (env override → persisted `setup_token` DB row) +
   `bootstrap` router (`adminExists`, `createAdmin`, rate-limited, audit-logged) +
   `/setup` screen (reads `?token=`) + the no-admin redirect. Test the full guard
   end-to-end (second call and token-less call both rejected).
4. Startup link in `instrumentation.ts` (log clickable `/setup?token=…` when no
   admin; nothing once one exists) + `restart.sh` `BETTER_AUTH_SECRET`
   auto-generation. Verify the link appears under `pnpm dev`, `pnpm start`, and a
   container start (manual — startup/shell, not unit-tested).
5. Feature-flag defaults: add `skills` + `mcp` (off); test `auto_node`, `skills`,
   `mcp` report disabled by default and `scheduled_node` stays enabled.
6. Onboarding use-cases: `GetOnboardingState` / `CompleteOnboarding` /
   `Get/SetDeploymentConfig` / `GetSetupStatus` — tests for read-default,
   complete-on-finish, complete-on-skip, and env-vs-DB configured/tested status.
7. tRPC procedures wired into the container; admin-only guards on non-bootstrap.
8. Wizard Step 1 (org name → `organisation.create`; multi-org checkbox →
   `organisation_resolution`) + explainers.
9. Wizard Step 2 (storage / AI / auth) with save + Test (existing probes),
   pre-fill/complete from `getSetupStatus`, warn-not-block, and the
   `SETTINGS_ENCRYPTION_KEY` pre-flight guard.
10. Wizard Step 3 (mail config+test; n8n toggle→modal→save+test; Skills toggle;
   MCP toggle) + **Skip** action; both Finish and Skip call `completeOnboarding`.
11. Layout gating + admin Settings "Re-run setup" entry point.
12. Documentation refocus: `README.md` quick-start, `.env.example`, getting-started
    guide(s) → zero-env path first, env demoted to "advanced / optional".
13. `./validate.sh`; fix all failures.

## 4a. Target quick-start (the spec for the docs refocus)

The README quick-start should reduce to roughly:

```
git clone … && cd wayfinder
docker compose up -d      # Postgres + MinIO (skip if you have your own)
./restart.sh              # generates secrets, migrates, starts the app
# → open the printed  http://localhost:3000/setup?token=…  link
# → set admin email + password, then complete the setup wizard
```

No `.env` editing in the default path. Env-based configuration moves to a
separate "Advanced / optional overrides" section for operators who want to preset
integrations or run without the wizard.

## 5. ADR required

ADR-041 (above). Assumes ADR-025, ADR-038, ADR-022.

## 6. Reused infrastructure (do not rebuild)

- `settings.set{Storage,Ai,Auth,Email,N8n}Config` mutations already exist.
- Connectivity probes (`connectivity-probes.ts`): AI, storage/MinIO, n8n, email,
  Entra — surfaced via `settings.testConnectivity` / `testAllConnectivity` /
  `sendTestEmail`. The wizard's Test buttons call these.
- Organisation CRUD + `organisation_resolution` (ADR-038) back Step 1.
- `featureFlag.upsert` backs the n8n / Skills / MCP toggles.

## 7. Risks / open questions

Carried from PRD §12:
- **Unauthenticated `createAdmin` guard** — defended in layers (ADR-041 §0):
  one-time setup token (logged), transactional singleton guard, seed-email
  binding, rate-limit + audit. The guard must live in the data layer, not just the
  UI. Baseline is token + singleton guard. Primary security risk.
- **Encryption-key ordering** — secret writes blocked until
  `SETTINGS_ENCRYPTION_KEY` is present (pre-flight guard).
- **"Complete" semantics** — a step is complete only when configured *and* its
  Test passes; an env value present but failing its probe must not read green.
- **First-run trigger** — bootstrap gates on "no admin exists"; the wizard gates
  on `onboarding_state`. Confirm the two gates compose (seeded-but-untested case).
- **Skills/MCP scope** — flags + toggles only this phase; no real config/test.
  Wizard copy must not imply a working integration.
- **Mail in skippable Step 3** — password-reset / notifications stay degraded if
  skipped; reflect in explainer copy.

## 8. Out of scope (this phase)

- **Removing** env-config fallbacks / deleting integration vars from
  `.env.example` (later `/enhance`). This phase demotes env in the docs but keeps
  every override working.
- Building Skills/MCP execution + their real config and Test.
- An embeddings/RAG wizard step.
- Resuming a partially-completed wizard across sessions.
