# Implementation Summary — Approver Directory Under Runtime Config

**Version**: 0.28.6  (bump: PATCH)
**Phase doc**: [`approver-directory-entra-config.phase.md`](./approver-directory-entra-config.phase.md)
**PRD**: [`step-approvals.prd.md`](../../../prd/step-approvals.prd.md) §7 —
"Entra/Graph configuration are surfaced here as modals, following the existing
admin settings pattern"
**ADR(s)**: [ADR-018](../../../adr/018-approval-step-and-approver-resolution.adr.md)
(extended 2026-08-22),
[ADR-025](../../../adr/025-configurable-auth-methods-and-entra.adr.md)
(runtime auth config, the pattern followed),
[ADR-041](../../../adr/041-first-run-onboarding-and-db-first-config.adr.md) §2
(DB-first, env kept as fallback),
[ADR-042](../../../adr/042-pki-under-runtime-auth-config.adr.md) §1 (the
database owns the switch, the environment owns the target)

## What was built

- **`DirectoryConfig` as runtime DB state.** `enabled`, a `credentialSource`
  (`email` | `auth` | `own`) and its own `entra` credentials, stored as one JSON
  row under `directory_config` in `admin_system_settings`, encrypted at rest
  because the key joins `SENSITIVE_SETTING_KEYS`. No DDL, no migration.
- **`resolveDirectoryCredentials`** in `packages/domain` — the single, pure
  answer to "which credentials is the directory using", returning `null` for both
  "off" and "chosen source is incomplete". It never falls back to a source the
  admin did not choose, so pointing the directory at one app registration cannot
  silently query another.
- **A resolver-based `GraphClient`.** The constructor now accepts either a fixed
  config or `() => Promise<GraphConfig | null>`; the container passes a resolver
  reading `RuntimeConfigStore.getDirectoryCredentials()`, so an admin's change
  applies on the next request with no redeploy. The OAuth token cache is keyed on
  the resolved credentials, so a rotated secret or a re-pointed tenant drops it
  rather than serving a token nobody granted.
- **An editable Approver Directory card.** Edit button, modal with an enable
  checkbox, a three-way credential-source radio group that says which sources are
  actually configured, and tenant/client/secret inputs shown only for separate
  credentials. The card body reports live state — On/Off, source in use, tenant,
  `•••• set`/`unset` — and warns when the directory is on but its credentials
  resolve to nothing. The existing `entra` connectivity Test is unchanged.
- **`settings.getDirectoryConfig` / `setDirectoryConfig`**, with the redacted
  secret, a blank-secret merge, a server-side rejection of "enabled with
  incomplete separate credentials", and cache invalidation. `setEmailConfig` now
  also invalidates the store's email cache, so a rotated M365 secret reaches the
  directory that inherits it.
- **A fix to the mock Entra provider** (see below), found while making the
  directory testable against the mocks.

## The mock Entra 404 — fixed here

Reported mid-implementation: with `restart.sh --with-mocks`, the Authentication
card's **Test** for Microsoft Entra ID failed with `HTTP 404` even though signing
in through the mock worked.

`probeAuthEntra` fetches the OpenID discovery document at
`{authority}/{tenant}/v2.0/.well-known/openid-configuration` to find the token
endpoint before it will attempt a client-credentials grant. The mock served
`/authorize`, `/token` and `/discovery/v2.0/keys` — but never the discovery
document — so the probe 404'd on its first request. Sign-in was unaffected
because Better Auth derives its endpoints from `authority` rather than reading
the document.

`mocks/entra/oidc.mjs` now serves it at both the `/v2.0/` and tenant-root
well-known paths, as the real authority does, with every endpoint pointed back at
the mock. Two tests lock it down: the mock's own suite asserts the document's
shape and that its advertised `token_endpoint` is the one the
client-credentials grant actually answers on, and `mock-fidelity.test.ts` drives
the **real `probeAuthEntra`** against the **real mock**, which is the test that
would have caught this originally.

## Files created

- `packages/adapters/src/config/` — no new files; parsers added to
  `runtime-config-defaults.ts`
- `apps/web/src/server/routers/settings-directory.ts` — input schema, merge, and
  the two procedures
- `apps/web/src/lib/container-app-registrations.ts` — `ENTRA_*` / `M365_*`
  credentials read out of the environment in one place
- `docs/development/implemented/alpha-2/v0.28.6/` — this doc and the phase doc

## Files changed

- `packages/domain/src/entities/runtime-config.ts` — `DirectoryConfig`,
  `DirectoryCredentialSource`, `DIRECTORY_CONFIG_SETTING_KEY`,
  `createDefaultDirectoryConfig`, `resolveDirectoryCredentials`,
  `createDefaultEmailConfig` (moved here from the web router), sensitive-key set
- `packages/adapters/src/config/runtime-config-defaults.ts` —
  `parseDirectoryConfig`, `parseEmailConfig`, `buildEnvDirectoryConfig`,
  `EnvDefaults.m365`
- `packages/adapters/src/config/runtime-config-store.ts` — `getDirectoryConfig`,
  `getEmailConfig`, `getDirectoryCredentials`, `invalidateDirectory`,
  `invalidateEmail`, `redactDirectory`
- `packages/adapters/src/directory/graph-client.ts` — `GraphConfigSource`, async
  `isConfigured()`, configuration-keyed token cache
- `packages/adapters/src/directory/graph-people-directory.ts`,
  `graph-reporting-line-resolver.ts` — await the async guard
- `packages/adapters/src/health/connectivity-probes.ts` — `GraphProbe`
- `apps/web/src/lib/container.ts`, `container-people-directory.ts` — resolver
  wiring; both files decomposed back under the 800-line ratchet
- `apps/web/src/server/routers/settings.ts` — spreads the directory procedures,
  invalidates the email cache, shares the domain's email default
- `apps/web/src/components/settings/entra-directory-card.tsx` — the card and modal
- `mocks/entra/oidc.mjs` — the discovery document
- `restart.sh`, `.env.example` — mock guidance points at the admin modal;
  `M365_*` annotated as fallbacks
- `docs/development/adr/018-*.adr.md` — extension note

## Behaviour preserved

An install running on `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET`
with no stored row reads as `{ enabled: true, credentialSource: "email" }` and
resolves exactly as before — no DB row, no admin action, no change in behaviour.
An incomplete set reads as off, as it did.

The Graph base URL and token authority stay environment-only. The input schema
does not carry them and zod strips unknown keys, so a request naming either is
dropped rather than honoured — a settings form must not be able to decide where a
client secret is sent.

## Tests

**No Playwright spec.** An admin settings form falls into none of the six groups
in [`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md) — no session
lifecycle, no streaming, no file transfer, no navigation state across a page
load. Coverage sits at the layers that own the logic:

| Layer | File | Covers |
| --- | --- | --- |
| domain | `runtime-config.test.ts` | credential resolution across all three sources, disabled, incomplete, and never borrowing another source |
| adapters | `runtime-config-store.test.ts` | tolerant parsing, the env fallback, DB-overrides-env, per-source resolution, cache invalidation, redaction |
| adapters | `directory.test.ts` | no request while unconfigured, token reuse, cache dropped on a rotated secret or changed tenant |
| adapters | `mock-fidelity.test.ts` | the real store + real client + real mock: admin-saved credentials resolve people and walk the reporting chain, an inherited email registration does the same, a disabled directory stays dark — plus the real sign-in probe against the real mock |
| adapters | `connectivity-probes.test.ts`, `composite-connectivity-tester.test.ts` | the async `entra` guard |
| apps/web | `settings.test.ts` | blank-secret merge, credentials surviving a switch to an inherited source, source validation, and that the schema carries no host fields |
| mocks | `entra/oidc.test.mjs` | the discovery document's paths, shape, and that it advertises a token endpoint that works |

## Known limitations

- An install with `M365_*` set in the environment that then saves a **disabled**
  directory row goes dark. That is DB-overrides-env working as designed — the row
  is the operator's explicit decision — but it is a visible change for that
  install and belongs in the release notes.
- Credential resolution adds a cached settings read to the people-search and
  reporting-line paths. The store's cache absorbs it and the Graph token cache
  still spans calls, so no additional network round trip is introduced.
- The directory is not part of the first-run setup wizard; it is configured from
  `/admin/settings` after setup, as before.

## Deviations from the approved change summary

- **`settings.ts` and `container.ts` were decomposed.** Both crossed the
  ratchet's 800-line fail line once the new code landed. The two directory
  procedures moved into `settings-directory.ts` beside their schema and merge,
  and the environment app-registration credentials moved into the new
  `container-app-registrations.ts`. Neither was in the approved summary; both
  were required to ship.
- **The mock Entra discovery-document fix** was added after the summary was
  approved, in response to the reported `HTTP 404` on the Authentication card's
  Test. It is a mock-only change plus two tests, and it is what makes the
  "testable from the mock" goal true for the Authentication card as well as this
  one.
- **`createDefaultEmailConfig` moved into the domain** rather than being
  duplicated, so the config store and the settings router share one default.
