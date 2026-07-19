# ADR-041 — First-Run Onboarding and DB-First Configuration

- **Status**: Accepted (scoped by `admin-first-login-setup.prd.md`)
- **Date**: 2026-07-19
- **Assumes**: ADR-025 (runtime auth config), ADR-038 (organisations as sharing
  scope), ADR-022 (feature-flag defaults and role scoping).

## Context

A fresh deployment is unusable until an admin account exists and object storage,
an AI provider, and a sign-in method are configured. Today the admin is
bootstrapped indirectly (`ADMIN_SEED_EMAIL` in env → self-register → promotion on
sign-in via `seedAdmin`), and the integrations live in `.env`, mirrored by
optional `admin_system_settings` rows that the app already prefers when present
(the runtime-config store reads DB-first, env-as-fallback for AI, storage, auth,
n8n, and email). There is no in-app way to create the admin, no guided first run,
and no signal for what is mandatory. The product intent is that **the database is
the single source of configuration truth**, leaving only the framework secrets
(`SETTINGS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`) — and an optional seed-email
fallback — in the environment.

Five decisions need recording: how the admin account is bootstrapped on first
run, how first-run onboarding is detected and gated, how far the DB-first move
goes in this phase (including how env-provided values surface in the wizard),
what the "multiple organisations" choice maps to, and the default state of the
automation-related feature flags.

## Decision

### 0. Admin is bootstrapped in-app by a self-disabling first-run screen

On the very first run — **before any sign-in** — the app serves a public
bootstrap screen that creates the admin account (email as username + password)
directly, via the existing auth adapter, and marks the new user admin. A public
`adminExists` read drives whether the screen is shown.

`ADMIN_SEED_EMAIL` becomes an **optional fallback**: if set, it pre-fills the
email field; if blank, the installer types it. The old "self-register then get
promoted on sign-in" path (`seedAdmin`) remains as a fallback for seeded installs
but is no longer the primary route. There is no separate username — email is the
identifier, matching the existing email-password auth.

#### Securing the unauthenticated bootstrap endpoint

`createAdmin` runs before any authentication exists, so it is defended in layers
rather than by a single UI check. The exposure window is only ever "first boot →
first admin" and closes permanently once an admin exists.

1. **One-time setup token (primary).** On first boot with no admin, a random
   setup token is generated and `createAdmin` requires it. This binds the right to
   bootstrap to host access, so reaching the `/setup` URL first is not sufficient.
   The token is auto-generated (zero config, on by default) and may also be
   supplied via env for automated installs — the same bootstrap-secret pattern
   `restart.sh` already uses for `SETTINGS_ENCRYPTION_KEY`. It is void once an
   admin exists. **`restart.sh` surfaces it as a ready-to-use setup link**: after
   migrations it checks whether an admin exists and, **only on first setup**,
   generates the token (into `.env`, mirroring the encryption-key step) and prints
   a clickable `${BETTER_AUTH_URL}/setup?token=<token>` URL to the console. The
   `/setup` screen reads the token from the query string to pre-fill the field, so
   the operator can click straight through; the token still comes from the local
   console (which requires host access) and is single-use. Once an admin exists,
   `restart.sh` prints no link and the endpoint refuses.
2. **Transactional singleton guard (correctness backstop).** The "no admin
   exists" check runs **inside** the insert transaction under an advisory lock (or
   a partial unique index enforcing at most one admin), so concurrent calls cannot
   race to create two admins. Enforced in the data layer, never only in the UI.
3. **Seed-email binding.** When `ADMIN_SEED_EMAIL` is set, `createAdmin` accepts
   only that address, so an attacker cannot bootstrap an admin under an email they
   control.
4. **Rate-limit + audit.** The endpoint is throttled, and a successful bootstrap
   is written to the immutable audit log (ADR-033) for detection.

Baseline is (1) + (2); (3) and (4) are belt-and-braces. Together they make a
public URL alone insufficient to seize the installation.

### 1. First-run onboarding is gated by one settings row, not a new table

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
trimming `.env.example` to secrets-only is deferred to a later `/enhance` once DB
config is proven in the field.

**Env-provided values are detected and reflected, not ignored.** For each step
the wizard reports whether it is already configured (from env or a DB row) and
pre-fills accordingly. A step is shown as **complete** only when it is *configured
and its Test passes* — an env value that is present but fails its connectivity
probe does not read as complete. This means an operator who set `MINIO_*`,
`ANTHROPIC_API_KEY`, `ENTRA_*`, etc. in env sees the wizard confirm those rather
than forcing re-entry, while still surfacing anything broken.

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

- **Positive**: An operator can go from a blank deployment to a working install
  entirely in-app — create the admin, then configure and test every critical
  integration in one place; no schema migration; non-breaking (env fallbacks
  intact and surfaced, not ignored); reuses existing auth, settings, probe,
  organisation, and feature-flag machinery.
- **Negative / trade-offs**: The `createAdmin` bootstrap endpoint is
  unauthenticated by necessity and carries real risk if its no-admin-exists guard
  is wrong — it must be enforced transactionally. Two config sources (DB + env)
  coexist until the deferred cleanup, so "where is this value set?" stays
  ambiguous for one more release. Installation-wide gating means a second admin
  never sees the wizard automatically (mitigated by the Settings re-run entry
  point). Skills/MCP appear in the UI as toggles before the features exist — copy
  must set expectations.
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
- **Keep admin bootstrap in env only** (`ADMIN_SEED_EMAIL` + self-register) —
  rejected as the primary path; it fails the "configure the deployment in-app"
  goal. Retained as a fallback rather than removed.
- **Separate username field** — rejected; email-password auth already keys on
  email, so email is the username. No new column or auth change.
- **Remove env config now** — rejected as breaking; deferred behind a proven
  DB-first path.
