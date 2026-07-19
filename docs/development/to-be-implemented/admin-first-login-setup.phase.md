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
| apps/web | setup-token bootstrap | On first boot with no admin, generate a random setup token, log it prominently; accept an env override for automation. Void once an admin exists. Mirror the `restart.sh` `SETTINGS_ENCRYPTION_KEY` auto-generation pattern. |
| apps/web | `app/setup/page.tsx` (new) | Public first-run screen: setup token + email (pre-filled from `ADMIN_SEED_EMAIL` if set) + password + confirm. Only reachable while `adminExists` is false; redirects to sign-in/app otherwise. |
| apps/web | middleware / entry redirect | On an install with no admin, route unauthenticated first load to `/setup`. |
| apps/web | `server/routers/settings.ts` | Add `getOnboardingState` (adminProcedure), `completeOnboarding`, `get/setDeploymentConfig`, and `getSetupStatus` (per-step configured/tested). Reuse existing `set*Config`, `testConnectivity`, `testAllConnectivity`, `sendTestEmail`. |
| apps/web | `components/onboarding/setup-wizard.tsx` (new) | Stepped modal: Step 1 deployment, Step 2 setup (required, warn-not-block), Step 3 site options (skippable). Per-item explainer + Test button; steps pre-filled and marked complete from `getSetupStatus`. |
| apps/web | `app/(admin)/admin/layout.tsx` | Mount the wizard; open when `onboarding_state.completed` is false. |
| apps/web | `app/(admin)/admin/settings` | "Re-run setup" control that opens the wizard without clearing the flag. |
| root | `VERSION`, `package.json` | Bump to `2.9.0`. |

## 3. Database changes

- **None (no DDL).** Admin → new `core_users` row via existing auth adapter. New
  `admin_system_settings` rows only: `onboarding_state`, `deployment_config`. Org
  name → existing `organisation.create` (`core_organisations`). Multi-org →
  existing `organisation_resolution`. `skills` / `mcp` → existing
  `core_feature_flag` (rows on first toggle).

## 4. Implementation order (tests first)

1. Domain: `OnboardingState` + `DeploymentConfig` types, keys, tolerant parsers
   — unit tests for malformed rows falling back to safe defaults.
2. `CreateFirstAdmin` + `AdminExists` use-cases — tests: creates on empty install,
   **refuses when an admin already exists**, **rejects a missing/wrong setup
   token**, honours seed-email binding, and cannot be raced into two admins
   (the security-critical guards).
3. Setup-token generation on first boot (log output + env override) + `bootstrap`
   router (`adminExists`, `createAdmin`, rate-limited, audit-logged) + `/setup`
   screen + the no-admin redirect. Test the full guard end-to-end (second call and
   token-less call both rejected).
4. Feature-flag defaults: add `skills` + `mcp` (off); test `auto_node`, `skills`,
   `mcp` report disabled by default and `scheduled_node` stays enabled.
5. Onboarding use-cases: `GetOnboardingState` / `CompleteOnboarding` /
   `Get/SetDeploymentConfig` / `GetSetupStatus` — tests for read-default,
   complete-on-finish, complete-on-skip, and env-vs-DB configured/tested status.
6. tRPC procedures wired into the container; admin-only guards on non-bootstrap.
7. Wizard Step 1 (org name → `organisation.create`; multi-org checkbox →
   `organisation_resolution`) + explainers.
8. Wizard Step 2 (storage / AI / auth) with save + Test (existing probes),
   pre-fill/complete from `getSetupStatus`, warn-not-block, and the
   `SETTINGS_ENCRYPTION_KEY` pre-flight guard.
9. Wizard Step 3 (mail config+test; n8n toggle→modal→save+test; Skills toggle;
   MCP toggle) + **Skip** action; both Finish and Skip call `completeOnboarding`.
10. Layout gating + admin Settings "Re-run setup" entry point.
11. `./validate.sh`; fix all failures.

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

- Removing env-config fallbacks / trimming `.env.example` (later `/enhance`).
- Building Skills/MCP execution + their real config and Test.
- An embeddings/RAG wizard step.
- Resuming a partially-completed wizard across sessions.
