# Phase — One Mock Org Directory Across HR, Entra and Graph

- **Status**: Implemented (v0.28.5)
- **Target version**: 0.28.5 — **PATCH** (config + dev tooling, no schema impact)
- **Base branch**: `release/alpha-2` (enhancement to shipped mock services)
- **Depends on**: ADR-018 (approver resolution — Entra authoritative, HR upload
  the fallback, operator always confirms), ADR-025 (Entra sign-in config
  precedence)
- **Extends**: `mocks/server.mjs` — one HTTP server, one path per mock. This
  phase adds two paths (`/hr`, `/graph`) and a shared data module the existing
  `/entra` and `/pki` mocks read from.

## 1. Goal

The local mocks currently know about three people — `ada`, `grace` and
`admin` — hardcoded twice, once in `mocks/entra/oidc.mjs` and once in
`mocks/pki/proxy.mjs`. There is no mock HR dataset at all, so the HR upload
path, the approver picker, the dynamic position lookup and both levels of
reporting-line resolution have never been driven locally against data that
looks like a real organisation.

This phase creates one deterministic roster of 100 employees spanning five org
levels and makes every mock read from it:

- the roster ships as a CSV for upload through **Settings → HR Directory Data**,
  so the HR path is exercised exactly as an operator would;
- the mock Entra sign-in picker offers those same people, so an account created
  by signing in matches an HR row by email;
- a new mock Microsoft Graph serves `/users` search and `/users/{id}/manager`
  from the same roster, so `GraphReportingLineResolver` can be driven on its
  **Graph** branch locally and not only on its HR-column fallback;
- the mock PKI proxy lists the same identities, so the three auth methods stop
  disagreeing about who exists.

Reaching the mock Graph needs one production-code change — `GraphClient` learns
an optional base URL and authority — and that is the only application code this
phase touches.

## 2. Business rules

| # | Rule | Behaviour |
| - | ---- | --------- |
| 1 | No product business rule changes | Federation, de-duplication, approver suggestion and confirmation are untouched |
| 2 | `GraphClient` honours a configured base URL and authority | Every Graph request and the client-credentials token request go there instead of `graph.microsoft.com` / `login.microsoftonline.com` |
| 3 | Unconfigured, `GraphClient` behaves exactly as today | Both hosts default to the real Microsoft ones; no existing deployment changes behaviour |
| 4 | The mock Entra token endpoint accepts `grant_type=client_credentials` | Returns an access token with no authorization code, so the mock Graph is reachable |
| 5 | `restart.sh --with-mocks` never exports M365 credentials | A complete `M365_*` set switches the Graph directory on by itself; the mock must not enable a feature behind the operator's back (same invariant validate.sh §21 already enforces for `ENTRA_*`) |

Rule 5 is the one that matters for safety. `buildPeopleDirectory` treats the
presence of all three `M365_*` values as "Graph is configured", so exporting
them from the mocks path would silently switch every mocked install onto Graph.
The mock exports only the two host overrides — inert without credentials — and
prints the credentials to paste.

## 3. UI / visible behaviour

- **Mock Entra picker** (`:4001/entra/:tenant/oauth2/v2.0/authorize`). Six
  featured identities as buttons — the CEO, an exec, a director, a manager, an
  IC and the existing `admin@example.com` — then a filter box over the full
  100-person roster. The free-typed email form stays exactly where it is, and
  the `mock-entra-identity`, `mock-entra-email` and `mock-entra-submit` testids
  keep their current meaning, because the shipped auth e2e specs drive the
  typed-email path.
- **Mock PKI connect page** (`:4001/pki/connect`). Lists the same featured
  identities instead of its own `ada`/`grace` pair, with each certificate's
  organisational unit taken from the employee's business unit.
- **`restart.sh --with-mocks` output.** One added block: the `curl` that saves
  `employees.csv`, a pointer to Settings → HR Directory Data, and the `M365_*`
  values to paste for the mock Graph.
- **No Wayfinder application UI changes.** The HR card, approver picker and
  position lookup render the new data through code that does not change.

## 4. Data & types

| Type | Change |
| ---- | ------ |
| `GraphConfig` (adapters) | `+ baseUrl?: string`, `+ authority?: string` — both optional, both defaulted inside `GraphClient` |
| `ServerEnv` (apps/web, apps/api) | `+ M365_GRAPH_BASE_URL?: string (url)`, `+ M365_AUTHORITY?: string (url)` |

No domain or application types change; no port signature changes.

New mock-side shape, confined to `mocks/` and crossing no package boundary:

```
RosterEmployee = {
  employeeId, name, email, managerEmail | null,
  jobTitle, band, businessUnit, level, location, startDate
}
```

**Org shape** — 100 employees, five levels, one root:

| Level | Count | Band | Reports to |
| - | - | - | - |
| 1 — Chief executive | 1 | `EXEC-1` | — |
| 2 — Executive | 5 | `EXEC-2` | the CEO |
| 3 — Director | 12 | `D` | an executive |
| 4 — Manager | 24 | `M` | a director |
| 5 — Individual contributor | 58 | `P1`–`P3` | a manager |

Five business units — Operations, Finance, Technology, People, Commercial —
each rooted at one executive, so a unit is a whole subtree and `businessUnit`
filtering in the position lookup returns a coherent group.

**CSV headers** are deliberately *not* the canonical field names, so the
column-mapping step has real work to do:

`Employee ID`, `Full Name`, `Employee Email`, `Manager Email`, `Job Title`,
`Grade`, `Business Unit`, `Location`, `Start Date`

Four of those (`Employee ID`, `Location`, `Start Date`, and whichever the
operator leaves unmapped) exercise the "extra columns are kept as uploaded"
behaviour of `ImportHrDataset`.

## 5. Files & packages touched

**adapters**
- `src/directory/graph-client.ts` (modify — optional `baseUrl` / `authority`)
- `src/directory/directory.test.ts` (modify — new cases)

**apps/web**
- `src/lib/env.ts` (modify — two optional URL vars)
- `src/lib/container-people-directory.ts` (modify — pass them into `GraphConfig`)

**apps/api**
- `src/env.ts` (modify — same two vars, kept in step with web)

**mocks**
- `directory/roster.mjs`, `directory/roster.test.mjs` (create)
- `hr/dataset.mjs`, `hr/dataset.test.mjs`, `hr/employees.csv` (create)
- `graph/api.mjs`, `graph/api.test.mjs` (create)
- `entra/oidc.mjs`, `pki/proxy.mjs`, `server.mjs`, `package.json` (modify)
- `vitest.config.mjs` (create — the package has no test runner today)

**root**
- `restart.sh` (modify — serve/print the new mocks), `validate.sh` (modify —
  extend §21 to M365 credentials), `.env.example` (modify), `VERSION`,
  `package.json`

## 6. Database & migration impact

None. No table, column or migration. The roster reaches `admin_hr_datasets` and
`admin_hr_rows` at runtime through the existing `ImportHrDataset` use case, the
same way any uploaded spreadsheet does.

## 7. Implementation order (tests before implementation)

1. `mocks/vitest.config.mjs` + `test` script, so the package runs tests at all.
2. `directory/roster.test.mjs` → `directory/roster.mjs` — count, uniqueness,
   manager closure, single root, level distribution, determinism.
3. `hr/dataset.test.mjs` → `hr/dataset.mjs`, then generate and commit
   `hr/employees.csv`; the test pins the committed file against a fresh
   generation so it can never drift.
4. `graph/api.test.mjs` → `graph/api.mjs` — `/users` search, `$top`, `/manager`,
   404 at the root.
5. `directory.test.ts` cases → `graph-client.ts` base URL and authority, then
   the env and container wiring in both apps.
6. `entra/oidc.mjs` picker and client-credentials grant; `pki/proxy.mjs`
   identities; `server.mjs` route registration.
7. `restart.sh`, `.env.example`, `validate.sh` §21.

## 8. Tests

- `mocks/directory/roster.test.mjs` — exactly 100 employees; emails unique and
  lowercase; every non-null `managerEmail` resolves to another employee; exactly
  one employee with no manager; five levels present with the documented counts;
  every employee's business unit matches its subtree root; two generations are
  deeply equal.
- `mocks/hr/dataset.test.mjs` — the CSV round-trips every employee; the header
  row is exactly the documented list; quoting survives a value containing a
  comma; the checked-in `employees.csv` is byte-identical to a fresh render.
- `mocks/graph/api.test.mjs` — `/users` matches on display name and on mail,
  honours `$top`, and returns `{ value: [] }` for no match; `/users/{email}/manager`
  returns the manager for an IC and 404s for the CEO; an unknown user 404s.
- `packages/adapters/src/directory/directory.test.ts` — `GraphClient` requests
  the configured base URL and the configured authority when both are set, and
  `graph.microsoft.com` / `login.microsoftonline.com` when neither is.
- **No e2e spec.** Measured against `docs/guides/e2e-test-policy.md`, none of
  the six groups is engaged: this is fixture data plus a host override. The
  auth-session lifecycle group is already covered by the shipped Entra specs,
  which drive the free-typed email field this phase leaves untouched.

## 9. Risks

- **Silently enabling Graph.** Covered by rule 5 and by extending validate.sh
  §21 to `M365_TENANT_ID` / `M365_CLIENT_ID` / `M365_CLIENT_SECRET`.
- **Touching a production auth path.** `GraphClient` builds both the token
  request and every Graph URL; the new tests pin the overridden and the default
  hosts so a regression cannot pass silently.
- **The mock Graph accepts any bearer token.** It is a mock and validates
  nothing. It lives behind `--with-mocks`, on the same loopback port as the
  existing mocks, and must never be reachable from a deployment.
- **`pnpm test` now covers `mocks`.** Adding vitest there means CI installs one
  more dev dependency and runs one more package.
- **Picker size.** 100 identities on the sign-in page is a lot of DOM; the
  featured-plus-filter layout keeps the first six buttons at the top so the
  existing `mock-entra-identity` selector still resolves quickly.

## 10. Out of scope

- Seeding the HR dataset directly into Postgres — the CSV is uploaded through
  the admin UI, as an operator would.
- Any change to federation, `mergePeople`, or approver-suggestion logic.
- Mocking the Graph profile-photo endpoint `entra-user-info.ts` calls.
- An XLSX variant of the roster; CSV covers the import path.
