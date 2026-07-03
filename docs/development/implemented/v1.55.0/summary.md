# v1.55.0 — Usage limit tiers (off / everyone / role / per-user) + usage meter

Implements `usage-limit-tiers.phase.md` (ADR-031). Generalises the per-user
spend cap into a small resolution cascade with a global master switch, and
surfaces each user's own usage as a subtle sidebar meter.

## What was built

- **Master switch** — a global on/off for all usage-limit enforcement, stored as
  one `admin_system_settings` row under key `usage_limits_config` (`{ enabled }`).
  Defaults to on: nothing is enforced until an admin configures a limit.
- **Scoped budgets** — `app_usage_budgets` now carries a `scope`
  (`everyone` / `role` / `user`), a nullable `role_key`, a nullable `user_id`,
  and a generated `scope_ref` (`COALESCE(user_id, role_key, 'everyone')`). The
  old `(user_id, period)` unique index is replaced by `(period, scope_ref)` so
  there is at most one budget per target per period across all scopes.
- **Pure resolver** — `resolveEffectiveBudget(candidates, roleKeys, period)` in
  `packages/domain` returns the single effective budget: user > role > everyone,
  with the most-restrictive (lowest limit) role winning a tie. Zero non-domain
  imports; reused by both enforcement and the meter so they never diverge.
- **Enforcement** — `QuotaEnforcer` reads the master switch (cached via
  `RuntimeConfigStore`, fail-open), loads the user's role keys, fetches enabled
  candidates, resolves per period, then evaluates exactly as before. Master-off
  is a zero-query fast path; every new lookup fails open (ADR-026 policy).
- **`usage.myUsage`** — a non-admin (`authenticatedProcedure`) query returning
  the caller's own `{ spendUsd, limitUsd, ratio, status, resetsAt }` per period
  with an effective limit, and `{ enabled: false }` when the switch is off or
  nothing resolves. Exposes only the caller's own numbers.
- **Admin UI** — the caps card (`spend-caps-card.tsx`, shared by `/admin/usage`
  and the governance dashboard) gains a master toggle, a scope selector
  (Everyone / Role / Specific user), and a Scope column.
- **End-user meter** — a new `usage-meter.tsx` renders a thin progress bar in the
  sidebar footer above the account block, coloured by ok/warn/blocked. A hover
  tooltip shows used, limit, remaining, percentage, and reset time per active
  period; it shows the most-constrained period. Hidden entirely when the switch
  is off or no limit resolves.

## Files created

- `packages/domain/src/entities/budget-resolution.ts` (+ `.test.ts`)
- `packages/application/src/use-cases/get-user-usage.ts`
- `packages/application/src/use-cases/usage-limits-settings.ts`
- `packages/application/src/use-cases/usage-limits.test.ts`
- `packages/adapters/drizzle/0027_clumsy_bushwacker.sql`
- `apps/web/src/components/usage-meter.tsx`
- `tests/e2e/phase-usage-limit-tiers.spec.ts`

## Files modified

- `packages/domain/src/entities/budget.ts` — `scope`/`roleKey`/nullable `userId`
  on `Budget`/`NewBudget`; new `budgetPeriodEnd` (+ tests).
- `packages/domain/src/entities/runtime-config.ts` — `UsageLimitsConfig`,
  `USAGE_LIMITS_CONFIG_SETTING_KEY`, `parseUsageLimitsConfig`, default.
- `packages/domain/src/ports/budget-repository.ts` — `findEnabledForUser` →
  `findEnabledCandidatesForUser(userId, roleKeys)`.
- `packages/adapters/src/db/schema/wayfinder.ts` — generalised
  `app_usage_budgets`.
- `packages/adapters/src/repositories/drizzle-budget-repository.ts` — scope
  columns + candidate query.
- `packages/adapters/src/config/runtime-config-store.ts` — cached
  `getUsageLimitsConfig` + `invalidateUsageLimits`.
- `packages/adapters/src/observability/quota-enforcing-adapter.ts` (+ test) —
  master switch + roles + resolver.
- `packages/application/src/use-cases/governance/create-budget.ts` — scope/target
  validation.
- `packages/application/src/use-cases/governance/get-governance-dashboard.ts` —
  cap utilisation limited to user-scoped budgets.
- `apps/web/src/lib/container.ts` — wire new use cases + enforcer deps.
- `apps/web/src/server/routers/governance.ts` — scope inputs +
  `settings.{get,set}UsageLimitsEnabled`.
- `apps/web/src/server/routers/usage.ts` — `myUsage`.
- `apps/web/src/components/admin/spend-caps-card.tsx` — master toggle + scope
  selector + Scope column.
- `apps/web/src/components/sidebar.tsx` — render `<UsageMeter />`.
- `apps/web/src/app/(user)/layout.tsx` — prefetch `usage.myUsage`.

## Migrations run

`0027_clumsy_bushwacker.sql` — additive: makes `user_id` nullable, adds `scope`
(default `'user'`), `role_key`, generated `scope_ref`, and swaps the unique
index to `(period, scope_ref)`. Existing per-user caps backfill to `scope='user'`
with `scope_ref = user_id`, so they keep enforcing unchanged.

## E2E tests added

`tests/e2e/phase-usage-limit-tiers.spec.ts` — admin ensures enforcement is On,
adds an Everyone limit (asserts the "Everyone" scope in the caps table), then
confirms the sidebar usage meter renders on a user page and disappears once
enforcement is toggled Off. Cleans up the created limit.

## Known limitations

- The e2e suite was not executed in the build sandbox (no Postgres/Redis/MinIO or
  running Next server, and the Playwright config has no `webServer`); it runs in
  CI on the PR.
- Cap utilisation on the governance dashboard shows user-scoped budgets only;
  everyone/role templates are surfaced in the caps table, not attributed to a
  single user.
- Meter accuracy reflects already-recorded spend, so it can momentarily read just
  under 100% while a limit-crossing call completes (inherited ADR-026 behaviour).

## Version bump

MINOR — 1.54.0 → 1.55.0 (DB schema change + new user-facing feature).
