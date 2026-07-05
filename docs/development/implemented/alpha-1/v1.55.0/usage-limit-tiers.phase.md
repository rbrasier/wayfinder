# Phase: Usage limit tiers (off / everyone / role / per-user) + user usage meter

## What & Why

Usage caps today are **per-user only**. An admin must add a row for every
individual user, and there is no way to say "apply this limit to everyone" or
"apply this limit to the `power_users` role." There is also no master switch to
turn enforcement off globally, and end users have no visibility into how much of
their allowance they have consumed.

This phase evolves the existing spend-cap feature into a small **resolution
cascade** and surfaces each user's current usage as a subtle meter on every user
page:

- **Off** — a global master switch disables all enforcement (the existing
  off-by-default fast path, made explicit and admin-controlled).
- **Everyone** — a single default limit that applies to all users.
- **By role** — an optional per-role limit that overrides the everyone default.
- **Per user** — an optional per-user limit that overrides everything else.

The unit stays **USD cost** (the existing summation and `evaluateBudget` logic
are reused unchanged — see decision below). The cascade is deliberately the
simplest thing that covers all four cases the request describes ("off, or for
everyone, by role with per-user overrides"): **most specific wins**.

### Decision: configured by group, enforced per user (ADR-031)

The limit **value** is configured at a scope (everyone / role / user), but the
ceiling is **always evaluated against an individual user's own current-period
spend** — exactly as ADR-026 does today. `role` and `everyone` rows are
**templates** that supply a `limitUsd` / `warnThresholdPct` for a period; they
are not a shared or pooled budget. Two users under the same role each get that
role's limit against their own spend, not a split of one pot. This keeps
enforcement, spend summation, and `evaluateBudget` byte-for-byte unchanged — the
only new logic is a **resolution step** in front of the existing evaluation.
This supersedes ADR-026 §2 (user-only scope); see **ADR-031** for the full
decision. The rest of ADR-026 (outermost decorator, pure evaluation, on-the-fly
spend, off-by-default, warn-then-block, `QUOTA_EXCEEDED` → session pause) stands.

### Decision: keep USD cost, reuse `evaluateBudget`

The feature is colloquially a "token limit," but the existing pipeline already
sums **cost** (`usageRepo.summarize` → `totalCostUsd`) and the pure
`evaluateBudget(budget, spendUsd)` function drives both enforcement and the
dashboard. Switching the enforced unit to raw tokens would fork that logic for
no functional gain (cost is a monotonic function of tokens and is what an admin
budgets against). We keep USD; the user-facing meter shows "$ used of $ limit."

## Scope

- **In scope**
  - A global master switch (`usage_limits_config.enabled`) stored in the
    existing `admin_system_settings` key/value table.
  - Generalising `app_usage_budgets` from user-only to a **scoped** limit
    (`everyone` / `role` / `user`).
  - A pure resolver that, given a user + their roles + a period, returns the
    single effective limit (most specific wins).
  - Enforcement (`QuotaEnforcer`) reading the master switch and the resolved
    effective cap.
  - A non-admin `usage.myUsage` procedure feeding a sidebar **usage meter**.
  - Admin UI: master toggle + scope selector on the existing caps card.
- **Out of scope**
  - Changing the enforced unit to tokens (see decision above).
  - Token/cost **alerts** beyond the existing warn-threshold audit log.
  - Per-flow or per-team limits (roles + users only for this phase).
  - Backfilling historical usage or changing how `usage_events` are recorded.

## Resolution model (the cascade)

For a given signed-in user and period (`daily` / `weekly` / `monthly`):

1. If the **master switch is off** → no limit. (Fast path, matches today's
   empty-caps behaviour.)
2. Otherwise pick the **most specific enabled** budget for that period:
   1. a **user**-scoped budget for this user, else
   2. a **role**-scoped budget for one of the user's roles, else
   3. the **everyone**-scoped budget, else
   4. no limit.
3. Evaluate the chosen budget against the user's current-period spend using the
   unchanged `evaluateBudget`.

**Role tie-break:** a user can hold multiple roles (`admin_user_roles` is
many-to-many). If more than one of their roles has an enabled budget for the
period, choose the **most restrictive** (lowest `limitUsd`). This is
deterministic and safe (never grants more than any applicable role allows).

Resolution is a **pure function** in `packages/domain` so it is unit-testable in
isolation and reused by both enforcement and the usage meter (no divergence).

## Entities / Use Cases Affected

### Domain (`packages/domain`)

- **`Budget`** (`entities/budget.ts`) — add:
  - `scope: BudgetScope` where `BudgetScope = "everyone" | "role" | "user"`.
  - `roleKey: string | null` (set when `scope === "role"`).
  - `userId: string | null` (now nullable; set only when `scope === "user"`).
  - `NewBudget` / `BudgetUpdate` mirror the new fields.
- **New pure resolver** `resolveEffectiveBudget(...)` (new
  `entities/budget-resolution.ts`): given the candidate enabled budgets for a
  user, the user's role keys, and a period, return the single effective
  `Budget | null` per the cascade above. `evaluateBudget` /
  `budgetPeriodStart` are unchanged.
- **`IBudgetRepository`** (`ports/budget-repository.ts`) — replace
  `findEnabledForUser(userId)` with
  `findEnabledCandidatesForUser(userId, roleKeys)` returning every enabled
  budget that *could* apply (user rows for this user + role rows for these role
  keys + everyone rows). The resolver then narrows per period. `list` gains no
  filter; `create` / `update` accept the new fields.

### Application (`packages/application`)

- **`createBudget` / `updateBudget` / `listBudgets`** — carry `scope`,
  `roleKey`. Validation: `scope === "user"` requires `userId`; `scope === "role"`
  requires `roleKey`; `scope === "everyone"` requires neither.
- **New `getUserUsage`** use case — for the signed-in user, resolve the
  effective budget per period, sum current-period spend, and return
  `{ period, limitUsd, spendUsd, ratio, status, resetsAt } | { enabled:false }`
  for the meter. Returns "no limit" cleanly when the switch is off or no budget
  resolves.
- **New `getUsageLimitsEnabled` / `setUsageLimitsEnabled`** — read/write the
  master switch via the existing system-settings repository.

### Adapters (`packages/adapters`)

- **`DrizzleBudgetRepository`** — map the new columns; implement
  `findEnabledCandidatesForUser` (one query with an `OR` over
  `scope='everyone'`, `scope='role' AND role_key = ANY(:roleKeys)`,
  `scope='user' AND user_id = :userId`).
- **`QuotaEnforcer.check`** (`observability/quota-enforcing-adapter.ts`) —
  1. read the master switch (cache within the request/short TTL; fail **open**
     if unreadable, consistent with existing fail-open policy);
  2. load the user's role keys;
  3. `findEnabledCandidatesForUser`, then `resolveEffectiveBudget` per period;
  4. evaluate exactly as today. The blocked/warn/audit paths are unchanged.

## Database

Single migration generalising **`app_usage_budgets`** (no new table):

| Column | Change |
|--------|--------|
| `scope` | **New** `text NOT NULL DEFAULT 'user'`, enum `('everyone','role','user')` |
| `role_key` | **New** `text NULL` (logical ref to `admin_roles.key`) |
| `user_id` | Altered to `NULL`-able (kept FK + `ON DELETE CASCADE` for user rows) |
| `scope_ref` | **New** generated/maintained `text` = `COALESCE(user_id::text, role_key, 'everyone')` for uniqueness |

- **Uniqueness:** replace the old `(user_id, period)` unique index with
  `(period, scope_ref)` so there is at most one budget per target per period
  across all scopes (one `everyone` per period, one per role per period, one per
  user per period).
- **Backfill:** existing rows are all per-user, so `scope` defaults to `'user'`
  and `scope_ref` resolves to their `user_id` — existing caps keep working with
  no data change.
- **Master switch:** no schema change — a single `admin_system_settings` row
  under new key `usage_limits_config` holding `{ "enabled": boolean }`
  (defaults to the current behaviour: switch **on** only surfaces limits that
  admins actually configure, so an empty install still enforces nothing).

## API (tRPC)

- **`governance.budgets.create` / `update`** — inputs gain
  `scope: 'everyone'|'role'|'user'`, `roleKey?`, and make `userId` conditional.
  Server validates the scope/target combination.
- **`governance.settings.getUsageLimitsEnabled` / `setUsageLimitsEnabled`** —
  new `adminProcedure`s for the master switch.
- **`usage.myUsage`** — new **`protectedProcedure`** (non-admin) returning the
  signed-in user's per-period effective limit + current spend for the meter.
  This is the only new surface a normal user can reach; it exposes only that
  user's own numbers.

## UI

### Admin — generalise the existing caps card

`components/admin/spend-caps-card.tsx` (already shared between `/admin/usage` and
the governance dashboard) gains:

- A **master switch** ("Usage limits: On / Off") at the top, wired to
  `governance.settings.*`. When off, the card shows an "enforcement disabled"
  note but still lets admins pre-configure limits.
- A **scope selector** in the add-limit form: **Everyone** / **Role**
  (role dropdown) / **Specific user** (existing user dropdown). The caps table
  gains a "Scope" column (e.g. `Everyone`, `Role: power_users`,
  `User: alice@…`). Enable/Disable/Delete are unchanged.

### End user — subtle usage meter (all user pages)

The app has **no top header**; the global chrome present on every user page is
the sidebar, whose footer already holds the account block
(`components/sidebar.tsx:262`). The meter lives **there**, directly above the
account block, so it appears on all user pages exactly as a header bar would:

- A **new `components/usage-meter.tsx`**: a thin (h-1 to h-1.5) progress bar
  fed by `usage.myUsage`. Fill ratio = `spendUsd / limitUsd`, coloured by
  status — `ok` (neutral/green), `warn` (amber, past the warn threshold),
  `blocked` (red, at/over limit).
- **Hover** (existing Tooltip primitive) reveals: `$X used of $Y this
  {period}`, remaining, percentage, and **resets** date/time
  (`budgetPeriodStart` + one period).
- **Hidden entirely** when the master switch is off or no limit resolves for the
  user — the bar never shows a meaningless full/empty state (this matches the
  "only when a limit applies" behaviour, chosen so users with no cap see nothing).
- If multiple periods have limits, the meter shows the **most-constrained** one
  (highest ratio); the tooltip lists each active period.

## User Flow

1. Admin opens `/admin/usage`, toggles **Usage limits → On**.
2. Admin adds an **Everyone** limit ($50 / monthly), a **Role** override for
   `power_users` ($200 / monthly), and a **User** override for one contractor
   ($10 / monthly).
3. A normal user signs in: the sidebar footer shows a thin bar; hovering reveals
   "$12.40 used of $50 this month · 25% · resets 1 Aug".
4. A `power_users` member sees their bar scaled to $200; the contractor's to $10.
5. When any user reaches their effective cap, the next AI call is blocked with
   the existing `QUOTA_EXCEEDED` message and the bar turns red.
6. Admin toggles **Usage limits → Off**: enforcement stops everywhere and every
   user's bar disappears — configuration is retained for when it is re-enabled.

## Files Changed (anticipated)

| File | Action |
|------|--------|
| `packages/domain/src/entities/budget.ts` | Add `scope`, `roleKey`, nullable `userId` to `Budget`/`New`/`Update` |
| `packages/domain/src/entities/budget-resolution.ts` (+ `.test.ts`) | New pure `resolveEffectiveBudget` cascade |
| `packages/domain/src/ports/budget-repository.ts` | `findEnabledForUser` → `findEnabledCandidatesForUser(userId, roleKeys)` |
| `packages/domain/src/entities/system-setting.ts` / `runtime-config.ts` | Add `usage_limits_config` key + `{ enabled }` shape |
| `packages/adapters/src/db/schema/wayfinder.ts` | Generalise `app_usage_budgets` (scope, role_key, nullable user_id, scope_ref, unique index) |
| `packages/adapters/src/db/migrations/*` | New migration for the above |
| `packages/adapters/src/repositories/drizzle-budget-repository.ts` (+ test) | Map new columns; candidate query |
| `packages/adapters/src/observability/quota-enforcing-adapter.ts` (+ test) | Master-switch check + resolver in `QuotaEnforcer` |
| `packages/application/src/use-cases/*budget*` (+ tests) | Scope-aware create/update/list |
| `packages/application/src/use-cases/get-user-usage.ts` (+ test) | New meter-feeding use case |
| `packages/application/src/use-cases/*usage-limits-settings* ` (+ test) | Master switch get/set |
| `apps/web/src/server/routers/governance.ts` | Scope inputs + `settings.{get,set}UsageLimitsEnabled` |
| `apps/web/src/server/routers/usage.ts` | New `myUsage` protected procedure |
| `apps/web/src/components/admin/spend-caps-card.tsx` (+ test) | Master toggle + scope selector + Scope column |
| `apps/web/src/components/usage-meter.tsx` (+ test) | New sidebar usage bar + tooltip |
| `apps/web/src/components/sidebar.tsx` | Render `<UsageMeter />` above the account block |
| `apps/web/src/app/(user)/layout.tsx` | Prefetch `usage.myUsage` |
| `tests/e2e/enhance-usage-limit-tiers.spec.ts` | New e2e (see below) |

## E2E Coverage

`tests/e2e/enhance-usage-limit-tiers.spec.ts` will exercise the primary new
behaviour end-to-end:

1. Admin enables usage limits and creates an **Everyone** limit and a **User**
   override.
2. Signed in as the overridden user, the sidebar usage meter renders and its
   tooltip shows "used of limit" for the override amount (proving the cascade
   picked the user row over the everyone row).
3. Admin toggles usage limits **off** → the meter disappears.

## Acceptance Criteria

- [ ] With the master switch **off**, no limit is enforced for any user and the
      enforcer runs no spend query (byte-for-byte the current off-by-default
      path); every user's sidebar meter is hidden.
- [ ] With the switch **on** and only an `everyone` $50/monthly budget enabled, a
      user with no role/user budget is evaluated against $50; at ≥ warn threshold
      the existing `budget.warn` audit event fires; at ≥ $50 the next AI call
      returns `QUOTA_EXCEEDED` and the session pauses (unchanged ADR-026 path).
- [ ] Adding a `role` budget for a role the user holds makes that role's limit
      win over the `everyone` budget for the same period.
- [ ] Adding a `user` budget for that user makes the user limit win over both the
      role and everyone budgets for the same period.
- [ ] When a user holds two roles that each have an enabled budget for the same
      period, the **lower `limitUsd`** is the one enforced.
- [ ] `resolveEffectiveBudget` is a pure function with unit tests covering: no
      candidates, everyone-only, role-over-everyone, user-over-role, and the
      multi-role most-restrictive tie-break — with **zero** non-domain imports.
- [ ] `usage.myUsage` returns the signed-in user's `{ spendUsd, limitUsd, ratio,
      status, resetsAt }` for each period with an effective limit, and a
      "no limit" result when the switch is off or nothing resolves; it exposes
      **only** the caller's own numbers and requires no admin role.
- [ ] The sidebar meter renders only when a limit resolves, colours by
      ok/warn/blocked, and its hover tooltip shows used, limit, remaining,
      percentage, and reset time.
- [ ] Existing per-user caps created before this phase continue to enforce
      unchanged after the migration (backfilled to `scope='user'`).
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version` are both
      `1.55.0`.

## Risks / Open Questions

- **Migration on a populated table.** Making `user_id` nullable, adding
  `scope` / `role_key` / `scope_ref`, and swapping the unique index runs against
  a table that may already hold per-user caps. **Mitigation:** `scope` defaults
  to `'user'` and `scope_ref` derives from `user_id`, so existing rows satisfy
  the new `(period, scope_ref)` unique index with no data edits; the migration is
  additive + one index swap. An e2e/asserted test confirms a pre-existing cap
  still enforces.
- **Added lookups on the hot path.** When limits are enabled the enforcer now
  reads the master switch and the user's roles in addition to the spend query.
  **Mitigation:** master switch cached with a short TTL; role keys fetched once
  per check; the off-by-default master switch preserves the zero-cost path for
  deployments not using limits. Both new lookups **fail open** (ADR-026 policy).
- **Overlapping role limits.** A user in multiple roles with different limits
  needs a deterministic rule. **Mitigation:** most-restrictive wins, documented
  and unit-tested; admins should expect the strictest applicable role to govern.
- **Meter accuracy vs. last-call overshoot.** Like enforcement, the meter reflects
  already-recorded spend, so it can momentarily read just under 100% while a call
  that crosses the limit completes (inherited ADR-026 behaviour, not a
  regression). Documented; not addressed here.
- **`scope_ref` uniqueness across NULLs.** Postgres treats NULLs as distinct in
  unique indexes, which is why a derived non-null `scope_ref` is used instead of a
  raw `(period, scope, role_key, user_id)` index. **Mitigation:** `scope_ref` is
  always non-null (`COALESCE(..., 'everyone')`); the use case also guards the
  scope/target combination before insert.

## Architecture / Rules Compliance

- Resolution is a **pure domain function** (zero deps) — respects the
  `packages/domain` no-dependency rule and is the single source of truth for
  both enforcement and the meter.
- All new port methods keep the **Result pattern**; enforcement keeps its
  **fail-open** policy (an infra blip must not halt all AI — ADR-026 / ADR-031).
- Table stays prefixed `app_` with `id` / `created_at` / `updated_at`; columns
  snake_case.
- No new dependency crosses a package boundary; adapters implement domain ports;
  apps consume application + adapters only.

## Version Bump

**MINOR — 1.54.0 → 1.55.0.** Adds a DB schema change (generalised
`app_usage_budgets`) and a new user-facing feature, with no breaking API or
domain contract removal beyond the internal `IBudgetRepository` method rename
(no external consumers). `VERSION` and root `package.json` are updated together
per the versioning rule.

## Open Questions

1. **Master-switch default on fresh installs** — proposed **on** (nothing is
   enforced until an admin configures a limit, so "on" is safe). Flip to **off**
   if you want enforcement to require an explicit opt-in toggle as well.
2. **Meter for admins** — show the same self-usage meter to admins, or hide it
   (they manage limits rather than live under them)? Proposed: show it only when
   a limit actually resolves for them, same rule as everyone else.
