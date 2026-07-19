# ADR-041 — First-Run Onboarding and DB-First Configuration

- **Status**: Accepted (scoped by `admin-first-login-setup.prd.md`)
- **Date**: 2026-07-19
- **Assumes**: ADR-025 (runtime auth config), ADR-038 (organisations as sharing
  scope), ADR-022 (feature-flag defaults and role scoping).

## Context

A fresh deployment is unusable until object storage, an AI provider, and a
sign-in method are configured. Today those live in `.env` and are mirrored by
optional `admin_system_settings` rows that the app already prefers when present
(the runtime-config store reads DB-first, env-as-fallback for AI, storage, auth,
n8n, and email). There is no guided first-run experience and no in-app signal for
what is mandatory. The product intent is that **the database is the single source
of configuration truth**, leaving only the seed admin email and the framework
secrets (`SETTINGS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`) in the environment.

Four decisions need recording: how first-run is detected and gated, how far the
DB-first move goes in this phase, what the "multiple organisations" choice maps
to, and the default state of the automation-related feature flags.

## Decision

### 1. First-run is gated by one settings row, not a new table

Onboarding state is a single `admin_system_settings` row under key
`onboarding_state` (`{ completed: boolean; completedAt: string | null }`), plain
(non-sensitive). The admin setup modal is shown to an authenticated **admin**
when `completed` is false, and suppressed otherwise. Gating is installation-wide:
the trigger is "an admin signs in and setup is not complete", not "each admin
once". This avoids a bespoke table for a boolean, matches the existing
settings-as-config pattern, and keeps the gate queryable on the layout path.

Finishing the wizard **or** skipping the optional step sets `completed = true`.
The modal never auto-reappears; admin Settings carries a manual "re-run setup"
entry point that opens the same wizard without clearing the flag.

### 2. DB-first, env kept as fallback (this phase)

The wizard writes every setting it touches to the database via the existing
`settings.set*Config` mutations and `organisation` procedures. Existing env vars
remain **optional bootstrap fallbacks** — the runtime-config store already reads
DB-first — so this phase is non-breaking. Removing env-config fallbacks and
trimming `.env.example` to seed-email + secrets is deferred to a later `/enhance`
once DB config is proven in the field.

**Secrets stay in the DB, encrypted.** Secret-bearing settings (storage/AI/auth/
n8n/email credentials) are encrypted at rest by the settings repository. Because
that encryption requires `SETTINGS_ENCRYPTION_KEY` at boot, the wizard performs a
**pre-flight check**: if the key is absent, secret-writing steps are blocked with
a clear message rather than silently persisting unencryptable secrets.

### 3. "Multiple organisations" maps to org-resolution strategy

Step 1's checkbox is not a cosmetic flag. Unchecked = **single-org**: the app
uses the `admin` resolution strategy and every user is placed in the one
organisation named in Step 1. Checked = **multi-org**: the wizard records the
intent (`deployment_config.multiOrganisation = true`) and the admin configures a
multi-org resolution strategy (`email_domain` / `self_nomination`, per ADR-038)
either in-wizard or from admin Settings. This reuses the existing
`organisation_resolution` machinery rather than inventing a parallel concept.

### 4. Automation feature flags default off

`auto_node`, `skills`, and `mcp` default **off**; `scheduled_node` stays **on**.
`skills` and `mcp` are new keys added to the code default list (feature-flag
rows are created only on first toggle, per ADR-022). This phase adds the flags
and their toggle UI only — the underlying Skills/MCP execution features, and any
config/test for them, are out of scope. n8n keeps its existing config + probe and
defaults off in the wizard.

## Consequences

- **Positive**: One place to configure a deployment; each critical integration is
  testable before use; no schema migration; non-breaking (env fallbacks intact);
  reuses existing settings, probe, organisation, and feature-flag machinery.
- **Negative / trade-offs**: Two config sources (DB + env) coexist until the
  deferred cleanup, so "where is this value set?" stays ambiguous for one more
  release. Installation-wide gating means a second admin never sees the wizard
  automatically (mitigated by the Settings re-run entry point). Skills/MCP appear
  in the UI as toggles before the features exist — copy must set expectations.
- **Follow-ups**: env-config deprecation + `.env.example` trim; real Skills/MCP
  config + test; optional embeddings/RAG wizard step.

## Alternatives considered

- **Dedicated `admin_onboarding` table** — rejected; a boolean does not warrant a
  table or migration when `admin_system_settings` already models config state.
- **Hard-block Step 2 until every Test passes** — rejected in favour of
  warn-and-proceed; a transient probe failure should not trap an admin out of
  their own setup. Revisit if broken installs become common.
- **Per-admin onboarding state** — rejected for this phase; setup is a
  deployment-level act, not a per-user one.
- **Remove env config now** — rejected as breaking; deferred behind a proven
  DB-first path.
