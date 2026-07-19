# PRD — Admin First-Run Setup

> Copy this file to `docs/development/prd/<short-slug>.prd.md`, fill it in,
> then route to the Documentation Review skill before any code is written.

- **Status**: Draft
- **Date**: 2026-07-19
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.9.0  (bump: **MINOR** — new feature, no schema change — see `docs/guides/versioning.md`)

## 1. Problem

A fresh Wayfinder deployment cannot do anything useful until an operator has
created an admin account and wired up object storage, an AI provider, and a
sign-in method. Today the admin account is bootstrapped indirectly — set
`ADMIN_SEED_EMAIL` in `.env`, restart, self-register with that email, and get
promoted to admin on sign-in — and the integrations are edited in `.env` and then
confirmed one by one on the admin Settings page. There is no guided first run: a
new operator has no in-app way to create the admin, no signal about what is
mandatory versus optional, and no way to test that each integration is reachable.
The result is a slow, error-prone first run that pushes configuration into the
environment when it could live in the database.

## 2. Users / Personas

- **Installer (no account yet)** — the person who has just stood the deployment
  up and loaded it in a browser for the first time. Has no credentials. Needs to
  create the admin account in-app, before any sign-in.
- **First-run administrator** — the account just created. Needs to get the
  installation to a working state quickly, with confidence that each critical
  integration is connected, without reading env-var docs or touching the server.
- **Returning administrator** — needs to re-open the setup flow later to review
  or change deployment-wide configuration from one place.

## 3. Goals

- On the **very first run, before any sign-in**, the app presents a screen where
  the installer creates the admin account (email as username + password). This
  screen is available only while no admin exists and self-disables afterward.
- Immediately after (still the same first run), a modal wizard walks the new
  admin through the configuration the app needs to function.
- Step 1 — **Deployment**: organisation name + whether **multiple organisations**
  will share the installation.
- Step 2 — **Setup** (required): object storage, AI provider, and sign-in method,
  each configurable and **testable** in place, each with a one-sentence explainer.
- Step 3 — **Site Options** (skippable): mail, n8n, Skills, MCP — each with a
  one-sentence explainer; enabling one that supports config opens an edit modal
  with a **Test** button after save.
- **Values already provided via env are detected and pre-filled**, and a step
  shows as **complete** when it is configured and its Test passes — so an operator
  who set things in `.env` sees the wizard reflect that rather than re-entering it.
- Every setting the wizard writes lands in the database, not the environment —
  the only env values that remain meaningful are the framework secrets and an
  optional seed email fallback.
- Finishing **or** skipping marks setup complete; the wizard never auto-reappears
  but is re-openable from admin Settings.
- `auto_node`, `skills`, and `mcp` feature flags default **off**.

## 4. Non-goals

- **Not** replacing normal user registration/sign-in. This adds a one-time,
  no-admin-exists bootstrap screen; ordinary users still sign in as they do today.
- **Not** building the underlying Skills or MCP execution features — this PRD only
  adds their feature flags (default off) and toggle UI. Config modals and live
  tests for Skills/MCP are out of scope until those features exist.
- **Not** removing env-based configuration. The wizard is DB-first; existing env
  vars remain optional bootstrap fallbacks that the wizard detects (see ADR-041).
  Trimming `.env.example` to secrets-only is deferred (§11).
- **Not** setting env-only secrets (`SETTINGS_ENCRYPTION_KEY`,
  `BETTER_AUTH_SECRET`). The wizard surfaces a pre-flight check when the
  encryption key is absent but cannot set it.
- **Not** adding a new onboarding database table — onboarding state is one
  `admin_system_settings` row; the admin account uses existing `core_users`.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| Admin `User` | `core_users` | existing | Created by the first-run bootstrap screen via the existing auth adapter, then marked admin. No new table. |
| `OnboardingState` | `packages/domain/src/entities/runtime-config.ts` | new | `{ completed: boolean; completedAt: string \| null }`. Stored as one `admin_system_settings` row (`onboarding_state`). Not sensitive. |
| `DeploymentConfig` | `packages/domain/src/entities/runtime-config.ts` | new | `{ multiOrganisation: boolean }` — records the Step 1 checkbox. Org name seeds a `core_organisations` row; the checkbox drives `organisation_resolution`. |
| `OrganisationResolution` | `packages/application/.../organisation-resolution-settings.ts` | existing | Single-org (`admin`) when unchecked, multi-org strategy when checked. |
| `StorageConfig`, `AiConfig`, `AuthConfig`, `EmailConfig`, `N8nConfig` | `entities/runtime-config.ts` | existing | Reused via existing `settings.set*Config` mutations; env values detected for pre-fill. |
| `FeatureFlag` (`skills`, `mcp`) | `core_feature_flag` | new keys | Added to the code default list, default **off**. `auto_node` stays default off. |

## 6. User stories

1. As an installer with no account, on the app's first run I land on a screen that
   lets me create the admin account (email + password) so I can proceed — and once
   an admin exists, that screen is no longer reachable.
2. As a first-run admin, right after creating my account I see a setup modal so I
   know exactly what the app needs before it can be used.
3. As a first-run admin, I enter my organisation name and tick "multiple
   organisations" if this installation serves more than one.
4. As a first-run admin, I configure S3/MinIO, the AI provider, and a sign-in
   method, and press **Test** on each to confirm it connects before moving on.
5. As a first-run admin who already set values in `.env`, I see those steps
   pre-filled and marked complete once their Test passes, so I don't re-enter them.
6. As a first-run admin, I optionally enable mail, n8n, Skills, or MCP; enabling
   one that supports config opens an edit modal with a **Test** button after save.
7. As a first-run admin, I can **skip** Step 3 and still finish setup.
8. As a returning admin, I can re-open the setup wizard from admin Settings.
9. As an admin, `auto_node`, `skills`, and `mcp` are off until I enable them.

## 7. Pages / surfaces affected

- **New** unauthenticated first-run screen (e.g. `app/setup/page.tsx` or a
  redirect target): shown only when **no admin user exists**; creates the admin
  account. Guarded server-side (transactional singleton + one-time setup token;
  see §12 and ADR-041) so the create-admin procedure refuses once any admin
  exists and a public URL alone cannot seize the install. Presents a setup-token
  field alongside email + password, pre-filled from a `?token=` query param.
- **`restart.sh`** — on **first setup only** (no admin exists after migrations),
  generate the setup token into `.env` and print a clickable
  `${BETTER_AUTH_URL}/setup?token=<token>` link to the console. Prints nothing
  once an admin exists.
- **New** `apps/web` client component: a stepped setup modal (e.g.
  `components/onboarding/setup-wizard.tsx`) shown to the signed-in admin when
  `onboarding_state.completed` is false.
- `app/(admin)/admin/settings` — add a "Re-run setup" entry point.
- tRPC — add `bootstrap.adminExists` (public read) + `bootstrap.createAdmin`
  (public, refuses when an admin exists); `settings.getOnboardingState`,
  `completeOnboarding`, `get/setDeploymentConfig`; a read that reports, per step,
  whether it is configured (env or DB) and last-tested status. Reuse existing
  `setStorageConfig`, `setAiConfig`, `setAuthConfig`, `setEmailConfig`,
  `setN8nConfig`, `testConnectivity`, `testAllConnectivity`, `sendTestEmail`.
- tRPC `organisation` router — reuse `create` (Step 1 org name) and
  organisation-resolution get/set for the multi-org toggle.
- tRPC `featureFlag` router — reuse `upsert` for the n8n / Skills / MCP toggles.
- Feature-flag defaults — add `skills` and `mcp` (off) to the code default set.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_users` | NEW admin row via existing auth adapter — no DDL | n/a |
| `admin_system_settings` | NEW rows only (`onboarding_state`, `deployment_config`) — no DDL | yes (existing table) |
| `core_organisations` | NEW row via existing `organisation.create` | n/a |
| `core_feature_flag` | NEW default keys `skills`, `mcp` (in code; rows only on first toggle) | n/a |

**No migration.** The feature is additive and rides existing tables.

## 9. Architectural decisions

- **ADR-041** (new) — First-run bootstrap + DB-first configuration policy:
  no-admin-exists bootstrap screen (self-disabling); onboarding state as one
  settings row; wizard writes to DB with env detected and kept as fallback;
  env-provided values shown pre-filled/complete; multi-org checkbox maps to
  `organisation_resolution`; `auto_node` / `skills` / `mcp` default off.
- Assumes **ADR-025** (runtime auth config), **ADR-038** (organisations as
  sharing scope), **ADR-022** (feature-flag defaults), and the existing
  settings-encryption-at-rest mechanism.

## 10. Acceptance criteria

- [ ] On a fresh install with no admin, the first run shows the admin-creation
      screen; submitting it creates an admin (email + password) and signs them in.
- [ ] `createAdmin` refuses (server-side) once any admin exists; the screen is not
      reachable thereafter.
- [ ] On first boot with no admin, a setup token is generated; `createAdmin`
      rejects a missing/wrong token. The token can also be supplied via env for
      automated installs and is void once an admin exists.
- [ ] On **first setup only**, `restart.sh` prints a clickable
      `${BETTER_AUTH_URL}/setup?token=<token>` link; once an admin exists it prints
      no link. The `/setup` screen pre-fills the token from the `?token=` param.
- [ ] Two concurrent `createAdmin` calls cannot both succeed (transactional
      singleton guard / advisory lock or partial unique index).
- [ ] When `ADMIN_SEED_EMAIL` is set, `createAdmin` accepts only that email.
- [ ] A successful bootstrap is written to the audit log; the endpoint is
      rate-limited.
- [ ] If `ADMIN_SEED_EMAIL` is set it pre-fills the email field as a fallback; if
      blank, the installer types the email. Email is the username (no separate
      username field).
- [ ] Right after admin creation, the setup modal appears for that admin; a
      non-admin never sees it.
- [ ] Step 1 saves an organisation (name) and persists the multi-org choice,
      wiring `organisation_resolution` to single- vs multi-org.
- [ ] Step 2 saves storage, AI, and auth config to `admin_system_settings`, each
      with a working **Test** button surfacing the existing probe result.
- [ ] A step whose value is already provided via env is pre-filled and shown as
      **complete** once its Test passes, without re-entry.
- [ ] Step 2 warns (does not hard-block) when a Test fails or hasn't run.
- [ ] Step 3 exposes mail (config + test), n8n (default off; toggle → modal →
      save + test), Skills (off, toggle only), MCP (off, toggle only), each with a
      one-sentence explainer, and can be **skipped**.
- [ ] Finishing or skipping sets `onboarding_state.completed = true`; the modal
      does not reappear on subsequent sessions.
- [ ] Admin Settings has a control that re-opens the wizard.
- [ ] `auto_node`, `skills`, `mcp` report disabled by default; `scheduled_node`
      stays enabled.
- [ ] When `SETTINGS_ENCRYPTION_KEY` is absent, the wizard shows a pre-flight
      warning before any secret-bearing step and the secret write is blocked.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json` are `2.9.0`.

## 11. Out of scope / future work

- Trimming `.env.example` to only framework secrets (+ optional seed email) and
  removing env-config fallbacks once DB config is proven (a follow-up `/enhance`).
- Building the Skills and MCP execution features and their real config + test.
- Adding an **embeddings/RAG** step to the wizard — embeddings config + reindex
  exist separately in admin Settings; not part of this wizard (candidate future).
- Resuming a partially-completed wizard across sessions.

## 12. Risks / open questions

- **Unauthenticated bootstrap endpoint** — `createAdmin` runs before any auth.
  Mitigated in layers (ADR-041 §0): a one-time **setup token** printed to server
  logs (primary), a **transactional singleton guard** against races, **seed-email
  binding**, and **rate-limit + audit**. Baseline is token + singleton guard; the
  guard must live in the data layer, never only in the UI. Primary security risk.
- **Encryption-key ordering** — secrets can only be stored once
  `SETTINGS_ENCRYPTION_KEY` exists. Mitigation: pre-flight check + blocked write.
- **Env detection semantics** — "complete" must mean *configured and tested*, not
  merely *env var present*; an env value that fails its probe should not show green.
- **First-run detection** — bootstrap gates on "no admin exists"; the wizard gates
  on `onboarding_state`. Confirm at Build these two gates compose cleanly (e.g. a
  seeded-but-untested install).
- **Step 2 warn-vs-block** — chosen: warn.
- **Mail coupling** — mail is skippable (Step 3) but backs password-reset /
  notifications; flagged for explainer copy.
