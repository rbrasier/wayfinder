# Implementation Summary — One Mock Org Directory Across HR, Entra and Graph

**Version**: 0.28.5  (bump: PATCH)
**Phase doc**: [`mock-org-directory.phase.md`](./mock-org-directory.phase.md)
**PRD**: [`step-approvals.prd.md`](../../../prd/step-approvals.prd.md),
[`entra-login-and-auth-methods.prd.md`](../../../prd/entra-login-and-auth-methods.prd.md)
**ADR(s)**: [ADR-018](../../../adr/018-approval-step-and-approver-resolution.adr.md)
(federated directory, Entra → HR precedence),
[ADR-025](../../../adr/025-configurable-auth-methods-and-entra.adr.md)
(auth config precedence)

## What was built

- **One shared roster of 100 employees** across five reporting levels — 1 chief
  executive, 5 executives, 12 directors, 24 managers, 58 individual contributors
   — in five business units, each unit a whole subtree under one executive. Built
  from literal tables with no randomness, so it renders identically every time.
- **A mock HR spreadsheet** at `:4001/hr/employees.csv`, uploaded through
  Settings → HR Directory Data like any other file. Its headers are deliberately
  non-canonical, and three of them map to nothing, so both halves of ADR-018's
  "stored as uploaded, mapped separately" decision get exercised.
- **A mock Microsoft Graph** at `:4001/graph`, serving `/users` search and
  `/users/{id}/manager` from the same roster. First- and second-level approver
  resolution can now be driven locally on its **Graph** branch, not only on the
  HR-column fallback.
- **The mock Entra picker** now offers the whole roster — six featured
  identities pinned to the top, one per org level plus the seeded admin, over a
  filter box — and its token endpoint answers `client_credentials`, which is what
  makes the mock Graph reachable.
- **The mock PKI proxy** lists those same featured identities, so signing in by
  certificate and by Entra land on the same address.
- **`GraphClient` learned two optional host overrides**, the only production
  code this change touches.

## Files created

- `mocks/directory/roster.mjs`, `mocks/directory/roster.test.mjs`
- `mocks/hr/dataset.mjs`, `mocks/hr/dataset.test.mjs`, `mocks/hr/employees.csv`
- `mocks/hr/download.mjs`, `mocks/hr/download.test.mjs`
- `mocks/graph/api.mjs`, `mocks/graph/api.test.mjs`
- `mocks/entra/oidc.test.mjs`, `mocks/pki/proxy.test.mjs`
- `mocks/test-support/http.mjs`, `mocks/vitest.config.mjs`

## Files modified

- `packages/adapters/src/directory/graph-client.ts` — `GraphConfig` gains
  optional `baseUrl` and `authority`; both default to the real Microsoft hosts,
  and a trailing slash on either is tolerated.
- `packages/adapters/src/directory/directory.test.ts` — four cases pinning both
  hosts, overridden and default.
- `apps/web/src/lib/env.ts`, `apps/api/src/env.ts` — `M365_GRAPH_BASE_URL` and
  `M365_AUTHORITY`, optional URLs.
- `apps/web/src/lib/container-people-directory.ts` — passes both through.
- `mocks/entra/oidc.mjs`, `mocks/pki/proxy.mjs`, `mocks/server.mjs`,
  `mocks/package.json`
- `restart.sh`, `validate.sh`, `.env.example`, `docs/guides/e2e-triage-ledger.md`
- `VERSION`, `package.json`

## Database & migration

None. No table, column or migration, and no `-- data-impact:` line. The roster
reaches `admin_hr_datasets` / `admin_hr_rows` at runtime through the existing
`ImportHrDataset` use case.

## Tests

68 tests in the `mocks` package (which had no test runner before this change)
plus four added to the adapters directory suite:

| File | Covers |
|---|---|
| `mocks/directory/roster.test.mjs` | 100 employees, unique lowercase emails and ids, documented level counts, every manager resolves, one root, every chain reaches the chief executive, units are whole subtrees, two builds are deeply equal |
| `mocks/hr/dataset.test.mjs` | header row, one row per employee, empty manager cell at the root, comma/quote/newline escaping, the suggested mapping, and the committed CSV pinned byte-for-byte against a fresh render |
| `mocks/hr/download.test.mjs` | csv download headers, `roster.json`, the index page, 404 and 405 |
| `mocks/graph/api.test.mjs` | `$search` parsing, match on name and mail, `$top`, empty collection, user by email and by employee id, the manager hop, a two-hop walk, 404 at the top of the org |
| `mocks/entra/oidc.test.mjs` | picker contents and preserved test ids, the code flow, directory claims in the id_token, a typed non-roster address, code replay, the client-credentials grant |
| `mocks/pki/proxy.test.mjs` | the certificate picker is drawn from the roster, OU follows business unit, failure toggles survive |
| `packages/adapters/src/directory/directory.test.ts` | `GraphClient` targets the configured hosts when set, the real ones when not, tolerates trailing slashes, and overrides one host without moving the other |

**No e2e test covers this change, deliberately.** Measured against
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md), none of the six
groups is engaged: this is fixture data plus a host override. The auth session
lifecycle group is already covered by the shipped Entra specs, which drive the
free-typed email field this change leaves untouched — including its
`mock-entra-email` and `mock-entra-submit` test ids.

## How to use it

```
./restart.sh --with-mocks
curl -sSO http://localhost:4001/hr/employees.csv
```

Upload the CSV at `/admin/settings` → HR Directory Data and map `Employee Email`
→ Email, `Full Name` → Display name, `Manager Email` → Manager, `Job Title` →
Position, `Grade` → Band, `Business Unit` → Business unit. Leave `Employee ID`,
`Location` and `Start Date` unmapped.

To drive the Graph path instead of the HR fallback, add the three `M365_*`
credentials to `.env` (any non-empty values); `restart.sh` prints them along with
the two host overrides it exports for you.

## Known limitations

- **The mock Graph authenticates nothing.** It reads no bearer token and serves
  the full directory to any caller. `M365_GRAPH_BASE_URL` pointing anywhere but
  loopback would send directory queries to an unauthenticated host, so it must
  stay behind `--with-mocks`. `validate.sh` §21 now guards the adjacent failure —
  `restart.sh` exporting `M365_*` credentials and switching Graph on by itself.
- **`$search` matching is a substring scan.** Real Graph scopes the term to the
  named field; the mock matches name, mail, job title or unit for any term.
- **No XLSX fixture.** The CSV covers the import path; the xlsx branch of
  `SpreadsheetParser` still has only its unit tests.
- **The roster is static.** There is no mock for hierarchy changes over time,
  and nothing writes back to it.

## Deviations from the approved summary

- **Featured identities.** The approved summary named "a manager, an IC"
  generically; the six are the chief executive, Grace Hopper (Technology
  executive), Ada Lovelace (Technology director), a manager, a contributor, and
  `admin@example.com`. `ada@`, `grace@` and `admin@` keep their original
  addresses so existing bookmarks and docs still resolve.
- **Every roster row is a `mock-entra-identity` button**, not just the featured
  six. One list with the featured entries pinned and highlighted keeps that
  selector meaning "any employee" wherever they sit.
- **Two files instead of one under `mocks/hr/`** — `dataset.mjs` holds the data
  and CSV rendering, `download.mjs` the HTTP handler — so the data module stays
  importable without the server contract.
- **`apps/api/src/env.ts` was also updated.** The approved summary listed only
  `apps/web`; both apps declare the `M365_*` block and drifting them apart would
  be a trap for the next person to wire Graph into the API.
- **`docs/guides/e2e-triage-ledger.md`** had one line naming what the CI mocks
  server provides; it now names Graph and HR too.
