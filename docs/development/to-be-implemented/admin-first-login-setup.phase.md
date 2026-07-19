# Phase — Admin First-Login Setup

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 2.9.0 — **MINOR** (new admin feature; all config is runtime
  state in existing tables; no schema migration).
- **PRD**: `docs/development/prd/admin-first-login-setup.prd.md`
- **ADR**: `docs/development/adr/041-first-run-onboarding-and-db-first-config.adr.md`
- **Depends on**: ADR-025 (runtime auth config), ADR-038 (organisations as sharing
  scope), ADR-022 (feature-flag defaults), existing settings-encryption-at-rest.

## 1. Goal

A gated, three-step setup modal shown on the seed admin's first authenticated
session that configures — and tests — everything the app needs to run, writing to
the database. Finishing or skipping the optional step marks setup complete; the
wizard is re-openable from admin Settings. `auto_node`, `skills`, and `mcp`
feature flags default off.

## 2. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/runtime-config.ts` | Add `OnboardingState` + `DeploymentConfig` types, their `*_SETTING_KEY` consts, and tolerant `parse*` helpers (mirror `parseSiemConfig`). Keys are **not** sensitive. Tests first. |
| application | `use-cases/onboarding/*.ts` | `GetOnboardingState`, `CompleteOnboarding`, `Get/SetDeploymentConfig` use-cases over `ISystemSettingsRepository`. Tests first. |
| application | `use-cases/get-feature-flag.ts` | Add `skills` + `mcp` to the default flag list, **off**; confirm `auto_node` is absent from `DEFAULT_ENABLED_FLAGS` (stays off). |
| adapters | `auth/seed-roles.ts` | Keep `auto_node` role-scoping intent; extend `POWER_USER_SCOPED_FLAGS` only if Skills/MCP should be power-user scoped (confirm at Build — default: leave unscoped). |
| apps/web | `server/routers/settings.ts` | Add `getOnboardingState` (adminProcedure), `completeOnboarding`, `get/setDeploymentConfig`. Reuse existing `set*Config`, `testConnectivity`, `testAllConnectivity`, `sendTestEmail`. |
| apps/web | `components/onboarding/setup-wizard.tsx` (new) | Stepped modal: Step 1 deployment, Step 2 setup (required, warn-not-block), Step 3 site options (skippable). Per-item explainer + Test button. |
| apps/web | `app/(admin)/admin/layout.tsx` | Mount the wizard; open when `onboarding_state.completed` is false. |
| apps/web | `app/(admin)/admin/settings` | "Re-run setup" control that opens the wizard without clearing the flag. |
| root | `VERSION`, `package.json` | Bump to `2.9.0`. |

## 3. Database changes

- **None (no DDL).** New `admin_system_settings` rows only: `onboarding_state`,
  `deployment_config`. Org name → existing `organisation.create`
  (`core_organisations`). Multi-org → existing `organisation_resolution`.
  `skills` / `mcp` → existing `core_feature_flag` (rows on first toggle).

## 4. Implementation order (tests first)

1. Domain: `OnboardingState` + `DeploymentConfig` types, keys, tolerant parsers
   — unit tests for malformed rows falling back to safe defaults.
2. Feature-flag defaults: add `skills` + `mcp` (off); test `auto_node`, `skills`,
   `mcp` report disabled by default and `scheduled_node` stays enabled.
3. Application use-cases: `GetOnboardingState` / `CompleteOnboarding` /
   `Get/SetDeploymentConfig` — tests for read-default, complete-on-finish,
   complete-on-skip.
4. tRPC procedures wired into the container; admin-only guards.
5. Wizard Step 1 (org name → `organisation.create`; multi-org checkbox →
   `organisation_resolution`) + explainers.
6. Wizard Step 2 (storage / AI / auth) with save + Test (existing probes),
   warn-not-block, and the `SETTINGS_ENCRYPTION_KEY` pre-flight guard.
7. Wizard Step 3 (mail config+test; n8n toggle→modal→save+test; Skills toggle;
   MCP toggle) + **Skip** action; both Finish and Skip call `completeOnboarding`.
8. Layout gating + admin Settings "Re-run setup" entry point.
9. `./validate.sh`; fix all failures.

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
- **Encryption-key ordering** — secret writes blocked until
  `SETTINGS_ENCRYPTION_KEY` is present (pre-flight guard). Primary risk.
- **First-login trigger** — installation-wide gate; confirm "first admin to sign
  in" is intended, not per-admin.
- **Skills/MCP scope** — flags + toggles only this phase; no real config/test.
  Wizard copy must not imply a working integration.
- **Mail in skippable Step 3** — password-reset / notifications stay degraded if
  skipped; reflect in explainer copy.

## 8. Out of scope (this phase)

- Removing env-config fallbacks / trimming `.env.example` (later `/enhance`).
- Building Skills/MCP execution + their real config and Test.
- An embeddings/RAG wizard step.
- Resuming a partially-completed wizard across sessions.
