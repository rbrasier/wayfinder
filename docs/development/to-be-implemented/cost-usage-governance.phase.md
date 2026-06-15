# Phase — Cost / Usage Governance

- **Status**: To be implemented
- **Target version**: 1.47.0 (bump: **MINOR** — new table, additive columns, new
  domain ports, new adapter; no breaking change)
- **PRD**: `docs/development/prd/cost-usage-governance.prd.md`
- **ADR**: `docs/development/adr/026-usage-governance-enforcement.adr.md`
- **Depends on**: existing usage tracking (`ai_usage_events`,
  `UsageTrackingAdapter`), flows/sessions, `core_audit_log`, RBAC (ADR-021),
  and the admin overview dashboard.

## 1. Goal

Record LLM spend by **user, flow, session, and team**, let an admin set optional
**budgets** per flow and per team (USD, `per_run` or `monthly`, off by default),
**warn then block** when spend crosses the threshold/limit, and visualise spend +
budget utilisation in a new admin governance dashboard. A **team** is an org-unit
**node** resolved from org structure (Entra manager chain first, uploaded HR
sheet as fallback) and picked via a level dropdown that walks the chain up/down —
not a free-text string.

## 2. Approach

Hexagonal, decorator-based (mirrors the existing usage-tracking decorator):

1. Thread `flowId` / `sessionId` / `team` (the acting user's resolved org-unit
   node) through the `ILanguageModel` call inputs so both recording and
   enforcement have scope. A new `IOrgStructure` port resolves the user's
   management chain (Entra-first, HR-sheet fallback) — generalising the existing
   reporting-line chain-walk (ADR-018).
2. `UsageTrackingAdapter` records the new fields (`org_node_id` + `team_label`); a
   new `QuotaEnforcingLanguageModel` decorator — ordered **outside** usage
   tracking — checks enabled budgets for the user's chain (leaf + ancestors)
   before each call and blocks with `QUOTA_EXCEEDED`.
3. Budget evaluation (`evaluateBudget`) is pure domain; current-period spend is
   summed on the fly from `ai_usage_events`, rolling up every `org_node_id` in a
   team budget node's subtree.
4. A blocked call pauses the session with a clear message; admins manage budgets
   and watch spend on a new dashboard.

See ADR-026 for enforcement point, decorator order, and the spend-computation
decision.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/budget.ts` | New `Budget` (`scopeRef` = flow id or org-unit node id, + cached `scopeLabel`) + pure `evaluateBudget(budget, spendUsd)`. |
| domain | `packages/domain/src/ports/budget-repository.ts` | New `IBudgetRepository` (`create`, `update`, `delete`, `findById`, `list`, `findEnabledForFlowAndOrgNodes(flowId, orgNodeIds)`). |
| domain | `packages/domain/src/entities/org-node.ts` | New `OrgNode` (`id`, `label`, `level`, `email`, `managerId`). |
| domain | `packages/domain/src/ports/org-structure.ts` | New `IOrgStructure` (`resolveChain(userId)`, `listTeamOptions(userId)`). |
| domain | `packages/domain/src/entities/usage-event.ts` | Add `flowId`, `sessionId`, `orgNodeId`, `teamLabel` to `UsageEvent` / `NewUsageEvent`. |
| domain | `packages/domain/src/ports/usage-repository.ts` | Extend `UsageFilter` (`flowId`, `sessionId`, `orgNodeIds`, `since`, `until`); add `summarizeBy(dimension)` for dashboard grouping. |
| domain | `packages/domain/src/ports/language-model.ts` | Add optional `flowId`, `sessionId`, `team` (`{ id, label }`) to the three call-input types. |
| domain | `packages/domain/src/result.ts` (error codes) | Add `QUOTA_EXCEEDED` to the `DomainError` code union. |
| application | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | Spend by flow/team over a period + budget utilisation. |
| application | `packages/application/src/use-cases/governance/{create,update,delete,list}-budget.ts` | Admin budget CRUD. |
| adapters | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | New decorator + `withQuotaEnforcement` factory. |
| adapters | `packages/adapters/src/observability/usage-tracking-adapter.ts` | Record `flowId` / `sessionId` / `orgNodeId` / `teamLabel`. |
| adapters | `packages/adapters/src/directory/{graph,hr}-org-structure.ts` | Implement `IOrgStructure` — walk the manager chain to the top (reuse `GraphReportingLineResolver` walk logic); Entra authoritative, HR fallback. |
| adapters | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | Implements `IBudgetRepository`. |
| adapters | `packages/adapters/src/repositories/drizzle-usage-repository.ts` | Honour new filters; aggregate by flow / org-node / period. |
| adapters | `packages/adapters/src/db/schema/ai.ts` | Add `flow_id`, `session_id`, `org_node_id`, `team_label` + indexes to `ai_usage_events`. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_usage_budgets` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: alter `ai_usage_events`, create `app_usage_budgets` + indexes. |
| adapters | agent graph `packages/adapters/src/agents/flow-session-graph.ts` | Resolve the user's chain once via `IOrgStructure`; pass `flowId` / `sessionId` / `team` (leaf node) + ancestor ids into every model call. |
| apps/web | `apps/web/src/server/routers/governance.ts` | New admin router: `spendByFlow`, `spendByTeam`, `utilisation`, `budgets.{list,create,update,delete}`, `teamOptions` (chain → dropdown nodes). |
| apps/web | `apps/web/src/server/router.ts` | Register `governance` router. |
| apps/web | `apps/web/src/app/(admin)/admin/dashboards/governance/{page.tsx,_content.tsx}` | New Recharts dashboard (spend by flow/team, utilisation, overruns); team budget picker is a level dropdown over `teamOptions`. |
| apps/web | `apps/web/src/app/(admin)/admin/page.tsx` | Link/card to the governance dashboard. |
| apps/web | `apps/web/src/lib/container.ts` | Wire `withQuotaEnforcement(withUsageTracking(provider))`, budget repo, `IOrgStructure` (Entra/HR), governance use-cases. |
| apps/web | session call paths (`run-turn`, `run-auto-node`) | Surface `QUOTA_EXCEEDED` → pause session with a clear message. |

## 4. Database changes

### Alter `ai_usage_events`

| Column | Type | Notes |
|--------|------|-------|
| `flow_id` | uuid FK → `app_flows` (`on delete set null`) | nullable |
| `session_id` | uuid | nullable |
| `org_node_id` | text | nullable — acting user's resolved team node |
| `team_label` | text | nullable — cached display label |

Indexes: `(flow_id, created_at)`, `(org_node_id, created_at)`, `(session_id)`.

### New table `app_usage_budgets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `scope` | text | `flow` \| `team` |
| `scope_ref` | text | flow id, or org-unit node id for a team |
| `scope_label` | text | cached display label |
| `period` | text | `per_run` \| `monthly` |
| `limit_usd` | real | |
| `warn_threshold_pct` | smallint | default 80 |
| `enabled` | boolean | default false |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(scope, scope_ref, period)`.

## 5. Environment variables

None. Budgets are data (DB-configured via the admin UI), not env config.

## 6. Implementation order (tests first)

1. **Domain**: `evaluateBudget` test → `budget.ts`; `OrgNode` + `IOrgStructure`
   port; add `QUOTA_EXCEEDED` code; extend `UsageEvent`, `UsageFilter`, and
   `ILanguageModel` inputs.
2. **Schema + migration**: alter `ai_usage_events`, create `app_usage_budgets`.
3. **Org structure**: `{graph,hr}-org-structure.test.ts` → adapters (generalise
   the existing chain-walk to return the full chain; Entra-first, HR fallback).
4. **Budget repo**: `drizzle-budget-repository.test.ts` → adapter
   (`findEnabledForFlowAndOrgNodes`).
5. **Usage repo**: extend filter/aggregation tests (org-node roll-up) → repo
   changes.
6. **Recording**: update `UsageTrackingAdapter` (record new fields) + test.
7. **Enforcement**: `quota-enforcing-adapter.test.ts` (off-by-default pass-through,
   warn, block, flow-vs-team stricter-wins, per_run vs monthly windows,
   subtree roll-up) → adapter + `withQuotaEnforcement`.
8. **Use-cases**: governance dashboard + budget CRUD + `teamOptions` tests →
   use-cases.
9. **Wiring**: container decorator order + `IOrgStructure`; resolve & thread
   context in the agent graph; `governance` router; register in root router.
10. **UI**: governance dashboard page + budget management with the team level
    dropdown; admin hub link.
11. **Session pause**: surface `QUOTA_EXCEEDED` in `run-turn` / `run-auto-node`.

Write the test file before each implementation file (CLAUDE.md rule). Run
`./validate.sh` and fix all failures before declaring done.

## 7. ADR required

ADR-026 (written) — enforcement decorator on `ILanguageModel`, decorator order,
context threading, on-the-fly spend computation, warn-then-block, off-by-default,
and the `QUOTA_EXCEEDED` → session-pause contract.

## 8. Risks / open questions

Carried from PRD §12 and ADR-026: context threading coverage, on-the-fly spend
query cost (counter table is the follow-up), last-call overshoot, streaming check
timing, org re-org / node stability, HR node identity on re-upload, chain-cache
lifetime, no-resolvable-structure fail-open, blocked-session UX, decorator order,
`budget.warn` audit de-duplication, and the `monthly` calendar boundary (default
UTC).

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] LLM calls record `flow_id` / `session_id` / `org_node_id` / `team_label`
      when known.
- [ ] A team budget targets an org-unit node chosen from the level dropdown
      (`teamOptions`); its spend rolls up the node's subtree; Entra is
      authoritative with HR-sheet fallback.
- [ ] No enabled budget ⇒ identical to today (recorded, never blocked, no spend
      query).
- [ ] Admin can CRUD + enable/disable flow and team budgets.
- [ ] Warn threshold flips status to `warn` + writes `budget.warn`; limit blocks
      the next call with `QUOTA_EXCEEDED`, pauses the session, writes
      `budget.blocked`; raising/disabling resumes.
- [ ] `per_run` sums by session; `monthly` sums since start of month; flow + team
      both apply with stricter-wins.
- [ ] Governance dashboard renders spend by flow/team + utilisation table.
- [ ] No framework import outside `packages/adapters`; `./validate.sh` passes;
      `VERSION` and `package.json#version` are `1.47.0` and match.
