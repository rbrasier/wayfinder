# PRD — Group-Scoped Authorization & Delegated Admin

> Extends the private/global flow model and the flat admin/non-admin split with
> **groups**: group-scoped flow visibility and delegated admins who manage their
> own group without full-admin rights.

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Target version**: 2.9.0 (bump: **MINOR** — new tables + additive visibility
  kind. Tentative sequencing.)

## 1. Problem

Flow visibility today is binary: **private** (owner only) or **global** (every
authenticated user), via the `FlowVisibility` union. Authorization is likewise
coarse — a user is either an admin (full power, wildcard permissions per ADR-021)
or not. A real organisation has departments: HR flows should be visible only to
the HR group, and an HR lead should manage HR's flows and members without being a
global admin. Neither is expressible today.

## 2. Users / Personas

- **Department lead / delegated admin** — owns a group (e.g. HR), manages its
  flows and membership, but must not touch other departments or global settings.
- **End user** — sees flows shared to groups they belong to, in addition to
  global flows.
- **Global administrator** — creates groups, assigns delegated admins, retains
  full control.

## 3. Goals

- Groups of users exist and are managed from the admin console.
- A flow can be published with **group visibility**: discoverable only by members
  of one or more named groups (a third `FlowVisibility` kind).
- A **delegated admin** role, scoped to a group, can manage that group's flows
  and membership without global-admin privileges.
- Effective-permission resolution (`computeEffectivePermissions`) accounts for
  group-scoped grants without breaking existing global roles.

## 4. Non-goals

- **Multi-tenancy / hard org isolation** — separate decision (gap #10, ADR-037).
  Groups are a sharing/delegation boundary, not a data-isolation boundary.
- Nested/hierarchical groups (flat groups this phase).
- Syncing groups from an IdP/directory (future; the `PeopleDirectory` port exists
  but claim/group mapping is out of scope here).
- Per-record ACLs beyond flow visibility.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Group` | `packages/domain/src/entities/group.ts` | new | Named group; has members and (optionally) a delegated admin. |
| `GroupMembership` | `packages/domain/src/entities/group-membership.ts` | new | user↔group link. |
| `FlowVisibility` | `packages/domain/src/entities/flow-visibility.ts` | existing | Add `{ kind: "group"; groupIds }`. |
| Permission registry | `packages/domain/src/entities/permission.ts` | existing | Add group-management permission key(s); resolution becomes group-aware. |

## 6. User stories

1. As a global admin, I create an "HR" group and assign Dana as its delegated admin.
2. As the HR delegated admin, I add/remove HR members and publish flows visible only to HR — without seeing or touching Finance's flows.
3. As an HR member, I see HR-group flows plus global flows in the New Chat modal; a non-member does not see HR flows.
4. As a global admin, I can still see and manage everything.

## 7. Pages / surfaces affected

- `/admin/groups` — **new**: create/edit groups, manage members, assign delegated admin.
- `/admin/flows` — flow visibility control gains a "Groups" option.
- New Chat modal / flow discovery — includes group-visible flows for the viewer's groups.
- `/admin/roles` — surfaces the group-management permission key(s).
- tRPC: `group.*` (list/create/update/addMember/removeMember/assignAdmin) with
  authorization that allows a delegated admin only within their group.
- `flow-visibility.ts` `isFlowDiscoverableBy` — extended for the `group` kind.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `admin_groups` | NEW — `id`, `name`, `description`, `created_at`, `updated_at` | yes (`admin_`, alongside `admin_roles`) |
| `admin_group_members` | NEW — `id`, `group_id`, `user_id`, `role_in_group` (`member`\|`delegated_admin`), timestamps | yes (`admin_`) |
| flow visibility storage | store `groupIds` when a flow's visibility kind is `group` (column/JSON on the existing flow table — confirm shape at Build) | n/a |

## 9. Architectural decisions

- **New:** ADR-036 — Group-scoped authorization: groups as a sharing/delegation
  boundary layered on ADR-021 RBAC; a third `FlowVisibility` kind; delegated
  admin as a group-scoped grant, **not** a new global tier.
- Assumes ADR-021 (RBAC, `computeEffectivePermissions`), the flow-visibility
  model, and ADR-001. Explicitly **not** multi-tenancy (ADR-037).

## 10. Acceptance criteria

- [ ] A global admin can create a group, add/remove members, and assign a delegated admin.
- [ ] A flow set to group visibility is discoverable by members of the named group(s) and by nobody else (except global admins).
- [ ] `isFlowDiscoverableBy` returns correct results for `private`, `global`, and `group` kinds (unit-tested).
- [ ] A delegated admin can manage only their own group's members and flows; calls targeting another group are rejected.
- [ ] A delegated admin cannot access global settings, other groups, or global-admin actions.
- [ ] `computeEffectivePermissions` continues to pass existing tests; group grants are additive, admins keep the wildcard.
- [ ] Removing a user from a group immediately removes their access to that group's flows.

## 11. Out of scope / future work

- Nested groups; IdP/directory-driven group sync; per-record ACLs; group-scoped
  data isolation (that is multi-tenancy, ADR-037).

## 12. Risks / open questions

- **Authorization surface:** every `group.*` and group-scoped flow action needs a
  "is the caller a delegated admin *of this group*?" check — easy to miss one;
  centralise the guard and test the negative paths hard.
- **Visibility storage shape:** whether `groupIds` lives in a column, JSON, or a
  join table on the flow — decide at Build against the existing flow schema.
- **Interaction with `workflow:publish_to_everyone`:** publishing to a group vs.
  to everyone should map cleanly onto existing permission keys.
- **Directory drift:** app-native groups may later diverge from IdP groups; sync
  is deliberately deferred.
