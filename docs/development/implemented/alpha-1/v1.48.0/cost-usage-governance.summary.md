# Implementation Summary — Cost / Usage Governance (v1.48.0)

- **Phase doc**: `cost-usage-governance.phase.md` (this folder)
- **PRD**: `docs/development/prd/cost-usage-governance.prd.md`
- **ADR**: `docs/development/adr/026-usage-governance-enforcement.adr.md`
- **Version bump**: **MINOR** — `1.47.5` → `1.48.0` (new table, additive columns,
  new domain port + adapter; no breaking change).

## What was built

Per-**user** spend **caps** (USD limit over a `daily` / `weekly` / `monthly`
period, **off by default**) with **warn-then-block** enforcement, flow/session
spend attribution for analytics, and a new admin governance dashboard.

- **Recording**: every recorded `ai_usage_events` row now carries `flow_id` and
  `session_id` (alongside the existing `user_id` / `conversation_id`) wherever
  those are known.
- **Enforcement**: a `QuotaEnforcer` (shared service) checks the acting user's
  enabled caps before each call, sums current-period spend on the fly, and
  returns `QUOTA_EXCEEDED` once a cap reaches its limit — writing a
  `budget.blocked` audit event. At the warn threshold it writes a (de-duplicated)
  `budget.warn` and proceeds. Wired as the outermost `ILanguageModel` decorator
  (`withQuotaEnforcement(withUsageTracking(provider))`); the chat stream route —
  which calls the Vercel SDK directly, outside the port — shares the same
  enforcer and pauses the session with a clear system message on block.
- **Off-by-default**: when `findEnabledForUser` returns nothing the call passes
  straight through with no spend query on the hot path.
- **Dashboard**: `/admin/dashboards/governance` shows total spend, spend-by-user
  and spend-by-flow bar charts, a cap-utilisation table (ok / warn / blocked),
  and per-user cap CRUD (user lookup + period select + limit + warn% + enable).

## Period windows (UTC)

`daily` = since 00:00 today; `weekly` = since 00:00 Monday; `monthly` = since the
1st of the calendar month. Multiple enabled caps all apply; the **stricter**
(first to block) wins.

## Files created

- `packages/domain/src/entities/budget.ts` (+ `.test.ts`) — `Budget`,
  `evaluateBudget`, `budgetPeriodStart`.
- `packages/domain/src/ports/budget-repository.ts` — `IBudgetRepository`.
- `packages/adapters/src/repositories/drizzle-budget-repository.ts`.
- `packages/adapters/src/observability/quota-enforcing-adapter.ts` (+ `.test.ts`)
  — `QuotaEnforcer`, `QuotaEnforcingLanguageModel`, `withQuotaEnforcement`.
- `packages/application/src/use-cases/governance/{create,update,delete,list}-budget.ts`,
  `get-governance-dashboard.ts`, `index.ts` (+ `governance.test.ts`).
- `apps/web/src/server/routers/governance.ts`.
- `apps/web/src/app/(admin)/admin/dashboards/governance/{page.tsx,_content.tsx}`.
- `packages/adapters/drizzle/0025_omniscient_winter_soldier.sql` (+ snapshot/journal).
- `apps/web/e2e/phase-cost-usage-governance.spec.ts`.

## Files modified

- Domain: `usage-event.ts` (+`flowId`/`sessionId`, `UsageGroupSummary`),
  `usage-repository.ts` (filter `flowId`/`sessionId`/`since`/`until` + `summarizeBy`),
  `language-model.ts` (`flowId`/`sessionId` on the three inputs),
  `errors/domain-error.ts` (`QUOTA_EXCEEDED`), entity/port indexes.
- Adapters: `db/schema/ai.ts` (`flow_id`/`session_id` + indexes),
  `db/schema/wayfinder.ts` (`app_usage_budgets`), `drizzle-usage-repository.ts`
  (record + filter + `summarizeBy`), `usage-tracking-adapter.ts` (record fields),
  repositories/observability indexes.
- Application: `services/resolve-field-values.ts`,
  `use-cases/document/structured-fields.ts`, `use-cases/session/run-auto-node.ts`
  (thread `userId`/`flowId`/`sessionId`), use-cases index.
- Web: `lib/container.ts` (budget repo, enforcer, governance use-cases, decorator
  order), `server/router.ts`, `server/trpc-errors.ts` (`QUOTA_EXCEEDED → FORBIDDEN`),
  `app/api/chat/[sessionId]/stream/route.ts` (pre-call quota check + record
  flow/session), `app/(admin)/admin/page.tsx` (hub link).

## Migrations run

`0025_omniscient_winter_soldier.sql`: adds `ai_usage_events.flow_id` (FK →
`app_flows`, on delete set null) + `session_id`; indexes
`(user_id, created_at)`, `(flow_id, created_at)`, `(session_id)`; creates
`app_usage_budgets` with a unique index on `(user_id, period)`.

## E2E tests added

`apps/web/e2e/phase-cost-usage-governance.spec.ts` (driven by the /e2e MCP skill,
excluded from the vitest run):

- **Happy path** — admin opens the governance dashboard and sees the spend
  breakdowns + cap utilisation; creates a per-user cap and toggles it.
- **Error path (user-visible)** — a user at their cap sends a message and sees a
  clear "usage cap" system message instead of an AI reply; the session stays
  active.

## Known limitations / follow-ups (from PRD §11)

- Current-period spend is summed on the fly per enforced call; a materialised
  counter table is the optimisation for high call volumes.
- Last-call overshoot: the call that crosses the limit still completes; streamed
  calls are checked at start, not mid-stream (governance ceiling, not prepay wall).
- Warn de-duplication is per process (in-memory) per user/period window.
- The enforcer fails **open** on a budget/usage lookup error — an infra blip
  must not halt all AI; a cap is a ceiling, not a hard wall.
- No per-flow / per-team budgets, no org-structure resolution, USD only, no
  billing/chargeback export, no cap-approaching email notifications.
