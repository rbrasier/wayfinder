# ADR-031 — Usage limit scope cascade (everyone / role / user) with per-user enforcement

- **Status**: Proposed (scoped by `usage-limit-tiers.phase.md`, target v1.55.0)
- **Date**: 2026-07-03
- **Supersedes**: ADR-026 §2 ("A cap is scoped to a single **user**") — the
  *enforcement subject* is unchanged (still an individual user's own spend), but
  the *configuration scope* is generalised from user-only to a cascade. The rest
  of ADR-026 (the outermost decorator, pure `evaluateBudget`, on-the-fly spend,
  off-by-default, warn-then-block, `QUOTA_EXCEEDED` → session pause) stands
  unchanged.

## Context

ADR-026 delivered per-user spend caps: an admin adds one `app_usage_budgets` row
per (user, period). That is the correct **enforcement** model — spend is a
per-user quantity — but a poor **configuration** model. To limit everyone, an
admin must add a row per user; to limit a group (e.g. `power_users`), there is no
mechanism at all; and there is no single switch to turn enforcement off.

The request is to configure limits for **groups of users** (everyone, or a role)
with **per-user overrides**, and a master **off** switch — while keeping the
budget itself applied to each individual user's own spend. In other words: the
limit *value* is chosen by group; the *ceiling is still evaluated per user*.
There is **no pooled or shared group budget** — two users under the same role
each get that role's limit against their own spend, not a split of one shared
pot.

## Decision

### 1. A limit is configured at a scope; it is always enforced per user

Generalise the budget from user-only to a **scope**:

- `everyone` — the default limit applied to every user.
- `role` — a limit for holders of a specific role (`admin_roles.key`).
- `user` — a per-user override.

`role` and `everyone` rows are **templates**: they define a `limitUsd` /
`warnThresholdPct` / `period`, but enforcement still sums the acting **user's**
own current-period spend and evaluates it against the resolved limit with the
unchanged pure `evaluateBudget`. No group aggregation, no shared counter.

### 2. Resolution: most specific wins, per period

For an acting user + period, the effective limit is the most specific **enabled**
budget:

1. a `user` budget for this user, else
2. a `role` budget for one of the user's roles, else
3. the `everyone` budget, else
4. no limit.

A user can hold several roles (`admin_user_roles` is many-to-many); if more than
one has an enabled budget for the period, the **most restrictive** (lowest
`limitUsd`) is chosen — deterministic and never more permissive than any
applicable role. Resolution is a **pure domain function**
(`resolveEffectiveBudget`), reused by both enforcement and the user-facing usage
meter so the two can never diverge.

### 3. Global master switch

A single `admin_system_settings` row (`usage_limits_config = { enabled }`) gates
all enforcement. Off → the enforcer short-circuits exactly like today's empty-caps
fast path (no spend query, no latency). The switch controls *enforcement*;
configured limits are retained while it is off so re-enabling is instant.

### 4. Schema: generalise `app_usage_budgets`, no new table

Add `scope` (`everyone`|`role`|`user`), nullable `role_key`, make `user_id`
nullable, and add a `scope_ref` (`COALESCE(user_id::text, role_key, 'everyone')`)
so uniqueness becomes `(period, scope_ref)` — one budget per target per period
across all scopes. Existing per-user rows backfill to `scope='user'` and keep
working unchanged.

### 5. Repository: resolve candidates in one query

`IBudgetRepository.findEnabledForUser(userId)` becomes
`findEnabledCandidatesForUser(userId, roleKeys)` — every enabled budget that
*could* apply (this user's `user` rows + `role` rows for these keys + `everyone`
rows). The pure resolver then narrows per period. The enforcer additionally reads
the user's role keys and the master switch; both lookups **fail open**, matching
ADR-026's policy that a governance ceiling must not halt all AI on an infra blip.

## Consequences

**Positive**

- One `everyone` row limits an entire deployment; one `role` row limits a group —
  without per-user data entry. Per-user overrides still take precedence.
- Enforcement, spend summation, and `evaluateBudget` are unchanged — the change
  is a resolution step in front of the existing evaluation, not a new model.
- The pure resolver is the single source of truth for both the enforcer and the
  new user usage meter.
- A master switch gives a true global off without deleting configuration.

**Negative**

- The enforcer now performs a role lookup and (cached) settings read in addition
  to the spend query when limits are enabled. Off-by-default and the master
  switch keep the zero-cost path for deployments not using limits.
- Multiple applicable role budgets need a tie-break rule (chosen: most
  restrictive). Documented; admins with overlapping role limits should expect the
  strictest to apply.

## Open questions — to resolve at build

- **Master-switch default** on a fresh install — proposed **on** (nothing is
  enforced until a limit is configured, so "on" is safe). Confirm at build.
- **Admin visibility** of their own meter — show only when a limit resolves for
  them (same rule as any user).
