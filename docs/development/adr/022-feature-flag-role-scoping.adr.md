# ADR-022 — Feature-Flag Role Scoping

- **Status**: Accepted
- **Date**: 2026-06-07
- **Depends on**: ADR-021 (roles & permissions)

## Context

Feature flags today are global on/off. `core_feature_flag` has `key`, `enabled`,
`rollout_pct` (stored but **not honoured** — always treated as 100%), and
`description`. `IsFeatureEnabled` (`packages/application/src/use-cases/get-feature-flag.ts`)
returns `flag.enabled ?? DEFAULT_ENABLED_FLAGS.has(key)`, and admin-only tRPC
(`featureFlag.isEnabled` / `featureFlag.upsert`) plus the `/admin/flags` page
toggle them. The existing flags `auto_node` and `scheduled_node` gate the auto
and scheduled node types in the flow builder and at runtime (e.g.
`isAutoNodeEnabled` / `isScheduledNodeEnabled` in
`apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts`).

With ADR-021 introducing roles, we want an enabled feature to optionally be
**narrowed to specific roles** — e.g. expose `auto_node` to Power Users while it
matures, without turning it on for everyone. The product owner's proposed shape
("a flag is on/off as now; when on it can be limited to roles") is the design we
adopt.

## Decision

### A flag's role allowlist lives in a join table, not on `core_feature_flag`

Add `admin_feature_flag_roles (flag_key, role_id)`. Rationale:

- Keeps referential integrity with `admin_roles` (a deleted role drops its
  scoping rows via FK), which a jsonb column on `core_feature_flag` could not.
- Leaves the existing `FeatureFlag` entity, `core_feature_flag` table, and the
  `featureFlag.upsert` path untouched — the flag stays a simple on/off record.
- Matches the `admin_` grouping for authorization data introduced in ADR-021.

`flag_key` is a **soft reference** to `core_feature_flag.key`, because a flag can
be default-on (`DEFAULT_ENABLED_FLAGS`) without a `core_feature_flag` row. When
an admin scopes a flag, we **upsert the flag row** first (so `enabled` is
explicit) and then write the allowlist — this avoids a scoped-but-rowless flag.

### Semantics

- **Allowlist empty** (no rows for the key) ⇒ available to **everyone** — today's
  behaviour, so existing flags are unaffected until explicitly scoped.
- **Allowlist non-empty** ⇒ available only to users whose roles intersect the
  allowlist, **plus admins, who always pass** (consistent with the ADR-021
  Admins wildcard).
- Scoping is independent of `enabled`: a disabled flag is off for everyone
  regardless of allowlist. The allowlist only ever **narrows** an enabled flag;
  it never enables a disabled one.
- Role scoping is **orthogonal to `rollout_pct`**, which remains inert. This ADR
  does not implement percentage rollout; if both are implemented later, the rule
  will be "enabled AND in-rollout AND role-permitted".

### The check becomes user-aware

Introduce `IsFeatureEnabledForUser(userId, key)` in the same use-case module:

```
enabled   = flag.enabled ?? DEFAULT_ENABLED_FLAGS.has(key)   // unchanged base
if not enabled              -> false
roleIds   = allowlist(key)
if roleIds is empty         -> true
if user.isAdmin             -> true
return userRoleIds(userId) ∩ roleIds ≠ ∅
```

The existing `IsFeatureEnabled(key)` (no user) is kept for contexts without a
user and is defined as the "empty allowlist" path (global enablement only).
Call sites that gate per-user behaviour — the flow builder node palette and the
runtime `turn-helpers` auto/scheduled checks — switch to the user-aware variant.

### Admin surface

`/admin/flags` (`_content.tsx`) gains, per enabled flag, a role multi-select
bound to a new admin-only `featureFlag.setRoles({ key, roleIds })` mutation
(empty array clears scoping ⇒ everyone). `featureFlag.isEnabled` becomes
user-aware for the calling user (`isEnabledForMe`).

### Seeding

The ADR-021 role seed also seeds `admin_feature_flag_roles` so that `auto_node`
and `scheduled_node` are scoped to **Power Users** on first migrate (admins still
pass via the wildcard). Seeding is idempotent and never overwrites an admin's
later scoping edits.

### Ports & layering

`FeatureFlagRoleRepository` (list/replace a flag's allowlist) is added to
`packages/domain/src/ports/feature-flag-repository.ts`, implemented in
`packages/adapters`, wired in `lib/container.ts`, Result pattern throughout.
`domain` stays dependency-free.

## Consequences

**Positive**

- Enabled features can be dark-launched to a role and widened later by clearing
  the allowlist — no schema change to roll out.
- The flag entity and its admin path stay simple; scoping is additive.
- One consistent admin-pass rule shared with ADR-021.

**Negative**

- A second per-request lookup (the user's role ids) feeds the flag check; it
  shares the same role query used for ADR-021 effective permissions, so in
  practice it is resolved once per request.
- A flag can now be "on" yet invisible to a given user, which is a new failure
  mode to reason about when debugging "why can't I see X" — the admin UI must
  show the active allowlist clearly.
- The soft `flag_key` reference means an allowlist row can outlive a renamed/
  removed flag key; cleaned up by the upsert-on-scope rule and tolerated by the
  "empty ⇒ everyone" default.

## Alternatives considered

- **`role_allowlist` jsonb column on `core_feature_flag`.** Simpler to read in one
  row, but loses FK integrity with `admin_roles`, mutates the existing flag
  entity/table, and mixes authorization data into `core_`. Rejected.
- **Make node access a permission instead of a scoped flag.** Auto/scheduled
  nodes are still maturing; a flag also lets us hard-disable them globally
  irrespective of role. Keeping them as flags (scoped to roles) preserves that
  kill-switch; a pure permission would not. Rejected.
- **Reuse `rollout_pct` for role targeting.** Different axis (percentage vs.
  named roles); conflating them would make both confusing. Kept orthogonal.
</content>
