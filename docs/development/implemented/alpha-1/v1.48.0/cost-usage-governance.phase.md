# Phase — Cost / Usage Governance

- **Status**: To be implemented
- **Target version**: 1.48.0 (bump: **MINOR** — new table, additive columns, new
  domain port, new adapter; no breaking change. Repo is at 1.47.5.)
- **PRD**: `docs/development/prd/cost-usage-governance.prd.md`
- **ADR**: `docs/development/adr/026-usage-governance-enforcement.adr.md`
- **Depends on**: existing usage tracking (`ai_usage_events`,
  `UsageTrackingAdapter`), flows/sessions, `core_audit_log`, RBAC (ADR-021),
  and the admin overview dashboard.

## 1. Goal

Record LLM spend by **user, flow, and session**, let an admin set optional
per-**user** spend **caps** (USD limit over a `daily`, `weekly`, or `monthly`
period, off by default), **warn then block** when spend crosses the
threshold/limit, and visualise spend (by user and by flow) + cap utilisation in
a new admin governance dashboard. Caps key on `user_id` — there is no flow/team
budget and no org-structure resolution; flow/session are recorded for dashboard
analytics only.

## 2. Approach

Hexagonal, decorator-based (mirrors the existing usage-tracking decorator):

1. Thread `flowId` / `sessionId` through the `ILanguageModel` call inputs so
   recording has flow/session context for the dashboard. The acting `userId` is
   already on the inputs and is the enforcement key — no new enforcement field is
   needed.
2. `UsageTrackingAdapter` records the new fields (`flow_id` + `session_id`); a new
   `QuotaEnforcingLanguageModel` decorator — ordered **outside** usage tracking —
   checks the acting user's enabled caps before each call and blocks with
   `QUOTA_EXCEEDED`.
3. Budget evaluation (`evaluateBudget`) is pure domain; current-period spend is
   summed on the fly from `ai_usage_events` for the user over the cap's period
   window.
4. A blocked call pauses the session with a clear message; admins manage caps
   and watch spend on a new dashboard.

See ADR-026 for enforcement point, decorator order, and the spend-computation
decision.

## 3. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/budget.ts` | New `Budget` (`userId`, `period`, `limitUsd`, `warnThresholdPct`, `enabled`) + pure `evaluateBudget(budget, spendUsd)`. |
| domain | `packages/domain/src/ports/budget-repository.ts` | New `IBudgetRepository` (`create`, `update`, `delete`, `findById`, `list`, `findEnabledForUser(userId)`). |
| domain | `packages/domain/src/entities/usage-event.ts` | Add `flowId`, `sessionId` to `UsageEvent` / `NewUsageEvent`. |
| domain | `packages/domain/src/ports/usage-repository.ts` | Extend `UsageFilter` (`userId`, `flowId`, `sessionId`, `since`, `until`); add `summarizeBy(dimension)` (`user` \| `flow`) for dashboard grouping. |
| domain | `packages/domain/src/ports/language-model.ts` | Add optional `flowId`, `sessionId` to the three call-input types. |
| domain | `packages/domain/src/result.ts` (error codes) | Add `QUOTA_EXCEEDED` to the `DomainError` code union. |
| application | `packages/application/src/use-cases/governance/get-governance-dashboard.ts` | Spend by user/flow over a period + cap utilisation. |
| application | `packages/application/src/use-cases/governance/{create,update,delete,list}-budget.ts` | Admin cap CRUD. |
| adapters | `packages/adapters/src/observability/quota-enforcing-adapter.ts` | New decorator + `withQuotaEnforcement` factory. |
| adapters | `packages/adapters/src/observability/usage-tracking-adapter.ts` | Record `flow_id` / `session_id`. |
| adapters | `packages/adapters/src/repositories/drizzle-budget-repository.ts` | Implements `IBudgetRepository`. |
| adapters | `packages/adapters/src/repositories/drizzle-usage-repository.ts` | Honour new filters; aggregate by user / flow / period. |
| adapters | `packages/adapters/src/db/schema/ai.ts` | Add `flow_id`, `session_id` + indexes to `ai_usage_events`. |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | New `app_usage_budgets` table. |
| adapters | `packages/adapters/drizzle/<next>.sql` | Migration: alter `ai_usage_events`, create `app_usage_budgets` + indexes. |
| adapters | agent graph `packages/adapters/src/agents/flow-session-graph.ts` | Pass `flowId` / `sessionId` into every model call (`userId` already passed). |
| apps/web | `apps/web/src/server/routers/governance.ts` | New admin router: `spendByUser`, `spendByFlow`, `utilisation`, `budgets.{list,create,update,delete}`. |
| apps/web | `apps/web/src/server/router.ts` | Register `governance` router. |
| apps/web | `apps/web/src/app/(admin)/admin/dashboards/governance/{page.tsx,_content.tsx}` | New Recharts dashboard (spend by user/flow, utilisation, overruns); cap editor is a user lookup + period (`daily`/`weekly`/`monthly`) select. |
| apps/web | `apps/web/src/app/(admin)/admin/page.tsx` | Link/card to the governance dashboard. |
| apps/web | `apps/web/src/lib/container.ts` | Wire `withQuotaEnforcement(withUsageTracking(provider))`, budget repo, governance use-cases. |
| apps/web | session call paths (`run-turn`, `run-auto-node`) | Surface `QUOTA_EXCEEDED` → pause session with a clear message. |

## 4. Database changes

### Alter `ai_usage_events`

| Column | Type | Notes |
|--------|------|-------|
| `flow_id` | uuid FK → `app_flows` (`on delete set null`) | nullable |
| `session_id` | uuid | nullable |

Indexes: `(flow_id, created_at)`, `(session_id)`. (`(user_id, created_at)` is
assumed to already back per-user spend queries; add it if absent.)

### New table `app_usage_budgets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `user_id` | uuid FK → `core_users` (`on delete cascade`) | cap subject |
| `period` | text | `daily` \| `weekly` \| `monthly` |
| `limit_usd` | real | |
| `warn_threshold_pct` | smallint | default 80 |
| `enabled` | boolean | default false |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

Unique index on `(user_id, period)`.

## 5. Environment variables

None. Caps are data (DB-configured via the admin UI), not env config.

## 6. Implementation order (tests first)

1. **Domain**: `evaluateBudget` test → `budget.ts`; add `QUOTA_EXCEEDED` code;
   extend `UsageEvent`, `UsageFilter`, and `ILanguageModel` inputs.
2. **Schema + migration**: alter `ai_usage_events`, create `app_usage_budgets`.
3. **Budget repo**: `drizzle-budget-repository.test.ts` → adapter
   (`findEnabledForUser`).
4. **Usage repo**: extend filter/aggregation tests (per-user period window,
   group-by user/flow) → repo changes.
5. **Recording**: update `UsageTrackingAdapter` (record `flow_id` / `session_id`)
   + test.
6. **Enforcement**: `quota-enforcing-adapter.test.ts` (off-by-default
   pass-through, warn, block, multiple-caps stricter-wins, daily/weekly/monthly
   windows) → adapter + `withQuotaEnforcement`.
7. **Use-cases**: governance dashboard + budget CRUD tests → use-cases.
8. **Wiring**: container decorator order; thread `flowId` / `sessionId` in the
   agent graph; `governance` router; register in root router.
9. **UI**: governance dashboard page + cap management (user + period); admin hub
   link.
10. **Session pause**: surface `QUOTA_EXCEEDED` in `run-turn` / `run-auto-node`.

Write the test file before each implementation file (CLAUDE.md rule). Run
`./validate.sh` and fix all failures before declaring done.

## 7. ADR required

ADR-026 (written) — enforcement decorator on `ILanguageModel`, decorator order,
context threading, on-the-fly spend computation, warn-then-block, off-by-default,
the per-user cap model, and the `QUOTA_EXCEEDED` → session-pause contract.

## 8. Risks / open questions

Carried from PRD §12 and ADR-026: flow/session context threading coverage,
on-the-fly spend query cost (counter table is the follow-up), last-call
overshoot, streaming check timing, blocked-session UX, decorator order,
`budget.warn` audit de-duplication, the daily/weekly/monthly calendar boundary
(default UTC), and disabled-vs-deleted cap semantics during an active blocked
session.

## 9. Acceptance criteria

Mirror PRD §10. At minimum:

- [ ] LLM calls record `flow_id` / `session_id` when known (alongside existing
      `user_id` / `conversation_id`).
- [ ] No enabled cap ⇒ identical to today (recorded, never blocked, no spend
      query on the hot path).
- [ ] Admin can CRUD + enable/disable per-user caps; one cap per period
      (`daily` / `weekly` / `monthly`) per user.
- [ ] Warn threshold flips status to `warn` + writes `budget.warn`; limit blocks
      the next call with `QUOTA_EXCEEDED`, pauses the session, writes
      `budget.blocked`; raising/disabling resumes.
- [ ] `daily` sums since 00:00 UTC today; `weekly` since 00:00 UTC Monday;
      `monthly` since the start of the UTC calendar month; multiple enabled caps
      apply with stricter-wins.
- [ ] Governance dashboard renders spend by user and by flow + utilisation table.
- [ ] No framework import outside `packages/adapters`; `./validate.sh` passes;
      `VERSION` and `package.json#version` are `1.48.0` and match.
