# PRD — Admin First-Login Setup

> Copy this file to `docs/development/prd/<short-slug>.prd.md`, fill it in,
> then route to the Documentation Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-07-19
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.9.0  (bump: **MINOR** — new feature, no schema change — see `docs/guides/versioning.md`)

## 1. Problem

A fresh Wayfinder deployment cannot do anything useful until an operator has
wired up object storage, an AI provider, and a sign-in method — today that means
editing `.env`, restarting, and then hunting through the admin Settings page to
confirm each integration works. There is no guided path: a new admin lands on an
empty app with no signal about what is mandatory versus optional, and no
in-app way to test that each integration is actually reachable. The result is a
slow, error-prone first run that pushes configuration into the environment when
it could live in the database.

## 2. Users / Personas

- **First-run administrator** — the person who stood up the deployment (the
  `ADMIN_SEED_EMAIL` account). Needs to get the installation to a working state
  quickly, with confidence that each critical integration is connected, without
  reading env-var docs or touching the server.
- **Returning administrator** — needs to re-open the setup flow later to review
  or change deployment-wide configuration from one place.

## 3. Goals

- On the admin's first authenticated session, a modal wizard appears that walks
  through the configuration required for the app to function.
- The admin can set **organisation name** and declare whether **multiple
  organisations** will share the installation (Step 1).
- The admin can configure and **test** object storage, AI provider, and sign-in
  method from inside the wizard (Step 2), each with a one-sentence explainer.
- The admin can optionally configure mail, n8n, Skills, and MCP (Step 3), each
  with a one-sentence explainer; Step 3 is **skippable**.
- Every setting the wizard writes lands in the database (`admin_system_settings`
  / existing tables), not the environment — the only required env values remain
  the seed email and the framework secrets.
- Finishing **or** skipping marks setup complete; the wizard never auto-reappears
  but is re-openable from admin Settings.
- `auto_node`, `skills`, and `mcp` feature flags default **off**.

## 4. Non-goals

- **Not** building the underlying Skills or MCP execution features — this PRD
  only adds their feature flags (default off) and toggle UI. Config modals and
  live tests for Skills/MCP are out of scope until those features exist.
- **Not** removing env-based configuration. The wizard is DB-first; existing env
  vars remain optional bootstrap fallbacks (see ADR-041). Trimming `.env.example`
  down to seed-email + secrets is deferred (§11).
- **Not** creating the admin account. The wizard runs *after* the seed admin has
  registered and signed in.
- **Not** setting env-only secrets (`SETTINGS_ENCRYPTION_KEY`,
  `BETTER_AUTH_SECRET`). The wizard surfaces a pre-flight check when the
  encryption key is absent but cannot set it.
- **Not** adding a new onboarding database table — onboarding state is one
  `admin_system_settings` row.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `OnboardingState` | `packages/domain/src/entities/runtime-config.ts` | new | `{ completed: boolean; completedAt: string \| null }`. Stored as one `admin_system_settings` row under `onboarding_state`. Not sensitive. |
| `DeploymentConfig` | `packages/domain/src/entities/runtime-config.ts` | new | `{ multiOrganisation: boolean }` — records the Step 1 checkbox intent. Org name seeds a `core_organisations` row; the checkbox drives `organisation_resolution`. |
| `OrganisationResolution` | `packages/application/.../organisation-resolution-settings.ts` | existing | Set to single-org (`admin`) when unchecked, or a multi-org strategy when checked. |
| `StorageConfig`, `AiConfig`, `AuthConfig`, `EmailConfig`, `N8nConfig` | `entities/runtime-config.ts` | existing | Reused as-is via existing `settings.set*Config` mutations. |
| `FeatureFlag` (`skills`, `mcp`) | `core_feature_flag` | new keys | Added to the code default list, default **off**. `auto_node` stays default off. |

## 6. User stories

1. As a first-run admin, on my first sign-in I see a setup modal so I know exactly
   what the app needs before it can be used.
2. As a first-run admin, I enter my organisation name and tick "multiple
   organisations" if this installation serves more than one, so org resolution is
   configured from the start.
3. As a first-run admin, I configure S3/MinIO, the AI provider, and a sign-in
   method, and I press **Test** on each to confirm it connects before moving on.
4. As a first-run admin, I optionally enable mail, n8n, Skills, or MCP; enabling
   one that supports config opens an edit modal with a **Test** button after save.
5. As a first-run admin, I can **skip** Step 3 and still finish setup.
6. As a returning admin, I can re-open the setup wizard from admin Settings to
   review or change deployment configuration.
7. As an admin, `auto_node`, `skills`, and `mcp` are off until I deliberately
   enable them.

## 7. Pages / surfaces affected

- **New** `apps/web` client component: a stepped setup modal (e.g.
  `components/onboarding/setup-wizard.tsx`) mounted in the admin layout, shown
  when `onboarding_state.completed` is false for the signed-in admin.
- `app/(admin)/admin/settings` — add a "Re-run setup" entry point.
- tRPC `settings` router — add `getOnboardingState` (public/authenticated read is
  admin-only), `completeOnboarding`, and `get/setDeploymentConfig`. Reuse
  existing `setStorageConfig`, `setAiConfig`, `setAuthConfig`, `setEmailConfig`,
  `setN8nConfig`, `testConnectivity`, `testAllConnectivity`, `sendTestEmail`.
- tRPC `organisation` router — reuse `create` (Step 1 org name) and the
  organisation-resolution get/set for the multi-org toggle.
- tRPC `featureFlag` router — reuse `upsert` for the n8n / Skills / MCP toggles.
- Feature-flag defaults — add `skills` and `mcp` (off) to the code default set.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_system_settings` | NEW rows only (keys `onboarding_state`, `deployment_config`) — no DDL | yes (existing table) |
| `core_organisations` | NEW row written via existing `organisation.create` | n/a |
| `core_feature_flag` | NEW default keys `skills`, `mcp` (in code; rows only on first toggle) | n/a |

**No migration.** The feature is additive and rides existing tables.

## 9. Architectural decisions

- **ADR-041** (new) — First-run onboarding gating + DB-first configuration policy:
  onboarding state as a single settings row; wizard writes to DB with env kept as
  fallback; multi-org checkbox maps to `organisation_resolution`; `auto_node` /
  `skills` / `mcp` default off.
- Assumes **ADR-025** (runtime auth config), **ADR-038** (organisations as
  sharing scope), **ADR-022** (feature-flag defaults/role scoping), and the
  existing settings-encryption-at-rest mechanism.

## 10. Acceptance criteria

- [ ] On a fresh install, the seed admin's first authenticated session shows the
      setup modal; a non-admin never sees it.
- [ ] Step 1 saves an organisation (name) and persists the multi-organisation
      choice, wiring `organisation_resolution` to single- vs multi-org.
- [ ] Step 2 saves storage, AI, and auth config to `admin_system_settings`, and
      each has a working **Test** button surfacing the existing probe result.
- [ ] Step 2 warns (does not hard-block) when a Test fails or hasn't run; the
      admin can still proceed. (Hard-block is an explicitly rejected alternative.)
- [ ] Step 3 exposes mail (config + test), n8n (default off; toggle → config
      modal → save + test), Skills (off, toggle only), MCP (off, toggle only),
      each with a one-sentence explainer, and can be **skipped**.
- [ ] Finishing or skipping sets `onboarding_state.completed = true`; the modal
      does not reappear on subsequent sessions.
- [ ] Admin Settings has a control that re-opens the wizard.
- [ ] `auto_node`, `skills`, and `mcp` report disabled by default (no row, not in
      the default-enabled set); `scheduled_node` stays enabled.
- [ ] When `SETTINGS_ENCRYPTION_KEY` is absent, the wizard shows a pre-flight
      warning before any secret-bearing step and the secret write is blocked.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json` are `2.9.0`.

## 11. Out of scope / future work

- Trimming `.env.example` to only the seed email + framework secrets, and
  removing env-config fallbacks once DB config is proven (a follow-up `/enhance`).
- Building the Skills and MCP execution features and their real config + test.
- Adding an **embeddings/RAG** step to the wizard — embeddings config + reindex
  exist separately in admin Settings; knowledge-base search needs them, but they
  are not part of this wizard (candidate future step).
- Multi-step progress persistence across sessions (resume a half-done wizard).

## 12. Risks / open questions

- **Encryption-key ordering** — secrets can only be stored once
  `SETTINGS_ENCRYPTION_KEY` exists. Mitigation: pre-flight check + blocked write
  (acceptance criteria). Primary correctness risk.
- **First-login detection** — gating on a single `onboarding_state` row is
  installation-wide (not per-admin). Confirm at Build that "first admin to sign
  in" is the intended trigger, not "each admin once".
- **Step 2 warn-vs-block** — chosen: warn. Revisit if operators ship broken
  installs by clicking through failing tests.
- **Mail coupling** — mail lives in the skippable Step 3 but also backs
  password-reset / notifications; skipping it leaves those degraded. Acceptable,
  flagged for the explainer copy.
