# Phase — Approver Directory Under Runtime Config

- **Status**: Draft (run `/doc-review` before building)
- **Target version**: 0.28.6 — **PATCH** (no schema change; one JSON row in the
  existing `admin_system_settings` table, same mechanism as `auth_config`)
- **Base branch**: `release/alpha-2`
- **ADR**: extends `docs/development/adr/018-approval-step-and-approver-resolution.adr.md`;
  follows the pattern set by `docs/development/adr/025-configurable-auth-methods-and-entra.adr.md`
  and `docs/development/adr/041-first-run-onboarding-and-db-first-config.adr.md`
- **Depends on**: ADR-001 (hexagonal boundaries), ADR-023 (M365 app registration
  for email), ADR-025 (runtime auth config), ADR-042 (PKI under runtime config —
  the precedent for "the database owns the switch, the environment owns the
  hosts")

## 1. Goal

An administrator configures the approver directory from `/admin/settings` —
switching it on, and choosing which Microsoft Entra app registration it uses —
without editing `.env` and without a redeploy. Today the Graph credentials are
read once, at container construction, from `M365_TENANT_ID` / `M365_CLIENT_ID` /
`M365_CLIENT_SECRET`, so the card can only describe environment variables it
cannot change.

What becomes possible:

- The directory is turned on and off, and re-pointed at a different app
  registration, from the admin UI; the change applies on the next request.
- One app registration serves email, sign-in and the directory without being
  typed three times — the card can **inherit** the Email card's M365 credentials
  or the Authentication card's Entra credentials.
- The local mock Graph (`restart.sh --with-mocks`) is exercised by pasting
  `mock-tenant` / `mock-client` / `mock-secret` into the modal, so live
  reporting-line resolution and people search can be driven locally with no
  `.env` edit — the same way mock Entra sign-in is already tested.
- Deployments configured through `M365_*` keep working unchanged, with no
  database row and no admin action.

## 2. Business rules

| Condition | Behaviour |
| --- | --- |
| `enabled` is false | Graph is not consulted; resolution falls back to the HR upload and manual pick, exactly as an unconfigured directory does today. |
| `enabled` is true and resolved credentials are incomplete | Same fallback. Fail-closed: a half-configured directory never half-works. |
| `credentialSource = "email"` | Credentials come from the Email card's `m365*` fields, falling back to env `M365_*` when the Email card holds none. |
| `credentialSource = "auth"` | Credentials come from `AuthConfig.entra` — the Authentication card's app registration. |
| `credentialSource = "own"` | Credentials come from this card's own `entra` fields. |
| Client secret submitted blank | The stored secret is kept. An admin can never read it back from the redacted display, so a blank field must not wipe it. |
| No stored row, env `M365_*` complete | Reads as `{ enabled: true, credentialSource: "email" }` — preserving the behaviour of every install running today. |
| No stored row, env `M365_*` incomplete | Reads as disabled. |
| Graph base URL / token authority | Environment-only, never settable from the form. |

The last rule is the one that is not negotiable. A directory lookup carries a
client secret to the host it is pointed at; letting an admin type that host into
a settings form turns a settings page into a credential-exfiltration primitive.
`M365_GRAPH_BASE_URL` and `M365_AUTHORITY` therefore stay exactly where
`GraphClient` documents them today — in the environment, for sovereign clouds and
for the local mock.

## 3. What is built

| Layer | File(s) | Change |
| --- | --- | --- |
| domain | `entities/runtime-config.ts` | `DirectoryConfig`, `DirectoryCredentialSource`, `DIRECTORY_CONFIG_SETTING_KEY`, `createDefaultDirectoryConfig()`, `resolveDirectoryCredentials()`; key added to `SENSITIVE_SETTING_KEYS`; `createDefaultEmailConfig()` moved here from the web router. |
| adapters | `config/runtime-config-defaults.ts` | `parseDirectoryConfig`, `parseEmailConfig`, `buildEnvDirectoryConfig`; `EnvDefaults.m365`. |
| adapters | `config/runtime-config-store.ts` | `getDirectoryConfig()`, `getEmailConfig()`, `getDirectoryCredentials()`, `invalidateDirectory()`, `invalidateEmail()`, `static redactDirectory()`. |
| adapters | `directory/graph-client.ts` | Config resolver instead of a fixed config; `isConfigured()` becomes async; token cache keyed on the resolved credentials so a rotated secret drops it. |
| adapters | `directory/graph-people-directory.ts`, `directory/graph-reporting-line-resolver.ts` | `await` the async `isConfigured()`. |
| adapters | `health/connectivity-probes.ts` | `GraphProbe.isConfigured(): Promise<boolean>`. |
| apps/web | `lib/container-people-directory.ts`, `lib/container.ts` | Build the Graph client from a `runtimeConfig`-backed resolver plus the env host overrides. |
| apps/web | `server/routers/settings-directory.ts` (new) | Input schema + merge, mirroring `settings-auth.ts`; keeps `settings.ts` under the source-size ratchet. |
| apps/web | `server/routers/settings.ts` | `getDirectoryConfig` / `setDirectoryConfig`; `setEmailConfig` also invalidates the store's email cache. |
| apps/web | `components/settings/entra-directory-card.tsx` | Edit button, modal, live summary rows; existing `entra` connectivity test kept. |
| repo | `restart.sh`, `.env.example` | Mock guidance points at the admin modal; `M365_*` annotated as fallbacks. |

### Types

```ts
export type DirectoryCredentialSource = "email" | "auth" | "own";

export interface DirectoryConfig {
  enabled: boolean;
  credentialSource: DirectoryCredentialSource;
  // Used when credentialSource === "own".
  entra: EntraCredentials;
}

export const resolveDirectoryCredentials = (
  config: DirectoryConfig,
  sources: { email: EntraCredentials; auth: EntraCredentials },
): EntraCredentials | null => ...
```

`resolveDirectoryCredentials` is pure and lives in `packages/domain`: it is the
single place that answers "which credentials is the directory actually using",
and it returns `null` for both "off" and "incomplete" so callers cannot
accidentally treat a half-configured directory as live.

## 4. Database changes

**None.** One JSON row under the existing `admin_system_settings` table
(`admin_` prefix), keyed `directory_config`, written through
`ISystemSettingsRepository` and encrypted at rest because the key is added to
`SENSITIVE_SETTING_KEYS`. No DDL, no generated migration, and therefore no
`-- data-impact:` line.

## 5. Implementation order (tests first)

1. **Domain** — `runtime-config.test.ts` for `resolveDirectoryCredentials` across
   all three sources, plus disabled and incomplete-credential cases; then the
   types and the resolver.
2. **Config store** — `runtime-config-store.test.ts` for tolerant parsing, the
   env fallback that preserves today's behaviour, DB-overrides-env, and cache
   invalidation; then `getDirectoryConfig` / `getEmailConfig` /
   `getDirectoryCredentials` and the invalidators.
3. **Graph client** — `directory.test.ts` for "no request when unconfigured",
   "token cache dropped when the credentials change", and the existing host
   overrides; then the resolver-based constructor and the async `isConfigured()`.
4. **Consumers** — `directory.test.ts` and `connectivity-probes.test.ts` /
   `composite-connectivity-tester.test.ts` updated for the async guard; then the
   `await` at each of the three call sites.
5. **Router** — `settings.test.ts` for redaction, blank-secret merge, rejection of
   an incomplete `own` source, and cache invalidation; then
   `settings-directory.ts` and the two procedures.
6. **Card** — the modal, the summary rows, and the retained connectivity test.
7. **Wiring and docs** — container, `restart.sh`, `.env.example`, ADR-018
   extension note.

`./validate.sh` runs after each numbered step.

## 6. Testing

No Playwright spec. An admin settings form falls into none of the six groups in
[`docs/guides/e2e-test-policy.md`](../../guides/e2e-test-policy.md) — there is no
session lifecycle, no streaming, no file transfer, no navigation state across a
page load. The behaviour is owned by, and tested at:

- `packages/domain` — credential resolution.
- `packages/adapters` — parsing, caching, the Graph client's configured/
  unconfigured branches, and the connectivity probe.
- `apps/web` router tests — redaction, merge, validation, invalidation.

`mocks/graph/api.mjs` needs no change: it already serves the roster, enforces the
`ConsistencyLevel: eventual` rule and requires a bearer token, and
`mocks/entra/oidc.mjs` already answers `grant_type=client_credentials` at the
token endpoint. What changes is only how an operator points the app at it —
through the modal rather than through `.env`.

## 7. Risks

- `isConfigured()` turning async touches three call sites and two test files; a
  missed `await` reads as permanently truthy. Each call site is covered by a test
  that fails on the un-awaited form.
- An install with env `M365_*` set that then saves a **disabled** directory row
  goes dark. That is correct — the row is the operator's explicit decision, and
  DB-overrides-env is the established rule — but it is a behaviour change for
  that install and belongs in the release notes.
- Resolving credentials per call adds a cached settings read to the people-search
  and reporting-line paths. The store's existing cache absorbs it, and the Graph
  token cache still spans calls.
- `validate.sh` section 21 (restart.sh must not pre-fill Entra or Graph
  credentials) must keep passing: the mocks path still exports host overrides
  only.

## 8. Out of scope

- Making Graph base URL / authority admin-editable.
- Any change to how the Email card or the Authentication card store their own
  credentials.
- Adding the approver directory to the first-run setup wizard.
- Broadening Graph usage beyond the existing people search and manager walk.
