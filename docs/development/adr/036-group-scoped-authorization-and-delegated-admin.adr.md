# ADR-036 — Group-Scoped Authorization & Delegated Admin

- **Status**: Proposed (scoped by `group-scoped-authorization.prd.md`)
- **Date**: 2026-07-18

## Context

ADR-021 gives Wayfinder a role/permission model: an admin holds a wildcard of all
permission keys; everyone else gets the union of grants across their roles
(`computeEffectivePermissions`). Flow visibility is the `FlowVisibility`
discriminated union — `private` or `global` — resolved by `isFlowDiscoverableBy`.

This is flat. There is no departmental boundary: no way to share a flow with just
HR, and no way to let an HR lead manage HR's flows and people without granting
full global admin. Large customers need both.

The design tension: add departmental scoping **without** turning into
multi-tenancy (hard data isolation), which is a separate, larger decision
(ADR-037). Groups here are a **sharing and delegation** boundary, not an
isolation boundary — all groups still live in one shared dataset.

Constraints:

1. **Layer on ADR-021, don't replace it.** Global roles/permissions and the admin
   wildcard keep working; group grants are additive.
2. **Extend, don't fork, `FlowVisibility`.** A third union kind, resolved in the
   same pure function that already gates `private`/`global`.
3. **Delegated admin is scoped, not a new global tier.** It must be impossible for
   a delegated admin to act outside their group.
4. **Hexagonal (ADR-001).** Groups and the discoverability/authorization
   predicates are pure domain; persistence and tRPC guards are adapter/app.

## Decision

### 1. Groups as a first-class, flat domain concept

Add `admin_groups` and `admin_group_members` (`role_in_group`:
`member` | `delegated_admin`), alongside the existing `admin_roles`. `Group` and
`GroupMembership` are domain entities. Groups are flat (no nesting) this phase.

### 2. A third `FlowVisibility` kind

Extend the union with `{ kind: "group"; groupIds: string[] }`. `isFlowDiscoverableBy`
gains one branch: a `group`-visible flow is discoverable when the viewer belongs
to any of `groupIds` (global admins always discover). The function stays pure and
fully unit-tested across all three kinds. Where a flow stores its `groupIds` (a
column, JSON, or a small join table on the flow) is settled at Build against the
existing flow schema; the domain contract is unchanged either way.

### 3. Delegated admin = a group-scoped capability, checked per request

Rather than a new global role tier, "delegated admin of group G" is membership
with `role_in_group = delegated_admin`. Authorization for every `group.*` action
and every group-scoped flow action runs through a single guard:
`isDelegatedAdminOf(user, groupId)` (pure predicate) OR the caller is a global
admin. The guard is centralised so the negative paths ("delegated admin of HR
touches Finance") are enforced in one place and tested exhaustively. Delegated
admins get **no** global-settings or cross-group access — those remain gated by
the existing admin check.

### 4. Effective permissions stay backward-compatible

`computeEffectivePermissions` keeps its current signature and behaviour for
global roles; group-scoped authorization is evaluated separately by the
group guard rather than folded into the global permission set. This keeps the
existing ADR-021 tests green and avoids conflating "what can this user do
globally" with "what can this user do within group G". A group-management
permission key (e.g. `group:manage_own`) is added to the registry so the
capability is visible/toggleable, but the *scoping* is enforced by the guard, not
by the flat key alone.

## Alternatives considered

- **Full multi-tenancy now.** Rejected for this phase — hard data isolation is a
  much larger, cross-cutting change and a distinct decision (ADR-037). Groups
  deliver departmental sharing/delegation without re-architecting every query.
- **Model groups as roles.** Rejected — roles answer "what can you do"; groups
  answer "who are you with / what can you see". Overloading roles to carry
  membership and visibility would tangle ADR-021 and make `everyone`/`admins`
  semantics murky.
- **A new global "delegated admin" role.** Rejected — without per-group scoping it
  is just a weaker global admin and cannot express "admin of HR only".
- **Nested groups.** Deferred — flat groups meet the requirement; hierarchy adds
  resolution complexity best justified by real demand.

## Consequences

**Positive**

- Departments get private-to-the-group flows and self-service delegated admins
  without global-admin sprawl.
- ADR-021 and its tests are untouched; the `FlowVisibility` change is one pure
  branch; delegation is one centralised, testable guard.
- Leaves multi-tenancy as a clean, separate decision rather than pre-empting it.

**Negative**

- A new authorization dimension multiplies the paths that must be guarded; a
  missed check is a cross-group leak. Mitigated by centralising the guard and
  testing negatives, but it is real surface.
- Groups are a sharing boundary, **not** isolation — two customers must not be put
  in one deployment and separated only by groups; that expectation must be
  documented to avoid misuse (and is exactly what ADR-037 addresses).
- Group membership and IdP groups can drift until directory sync (future work).
