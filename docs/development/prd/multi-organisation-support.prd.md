# PRD — Multi-Organisation Support (Internal Flow-Sharing Scope)

> A deployment can group its users into **organisations** — an internal audience
> one rung coarser than a group. A flow can be published to the owner's
> organisation, and an admin manages organisations and assigns users to them.
> Organisations are a *sharing* boundary, not a data-isolation boundary.

- **Status**: Draft
- **Date**: 2026-07-18
- **Author**: richy.brasier@gmail.com
- **Supersedes design**: the earlier pooled-RLS multi-tenancy PRD (ADR-037). See
  ADR-038 for why the isolation model was withdrawn in favour of a sharing scope.
- **Target version**: MINOR (stays on the 2.x line). Adds one table
  (`core_organisations`), one nullable column (`core_users.organisation_id`), and
  one `FlowVisibility` variant. Everything is additive: with no organisations
  created and every user's `organisation_id` null, behaviour is identical to
  today, so no domain or API contract is removed or changed.

## 1. Problem

Wayfinder can publish a flow to yourself, to a group (ADR-036), or to everyone.
There is no middle rung between "a group" and "everyone" that matches how a
single operator is actually structured — by department, business unit, or client
team. Operators want to publish a flow to *their whole organisation* without
enumerating groups, and to place each user into the organisation they belong to.

This is a **sharing** need, not an isolation need. Operators who require isolated
data (one org must never see another's sessions or documents) run a **separate
deployment**; that is out of scope here (see ADR-038).

## 2. Users / Personas

- **Administrator** — creates and renames organisations and assigns each user to
  one, in the existing admin surface (alongside role and team).
- **Flow author** — publishes a flow to their organisation, the same way they
  publish to a group or globally today.
- **End user** — sees flows published to their organisation, in addition to their
  private, group, and global flows.

## 3. Goals

- An admin can create, rename, and delete organisations from `/admin/organisations`.
- An admin can assign a user to an organisation (or leave them unaffiliated), and
  can instead choose an automatic sign-in resolution strategy: `sso_claim`,
  `email_domain`, or `self_nomination`.
- A flow author can set a flow's visibility to `organisation`; it becomes visible
  to every user in the **owner's** organisation.
- With no organisations created and all users unaffiliated, behaviour is
  identical to today.
- Organisation carries **no** data-isolation semantics: sessions, uploads,
  documents, and audit rows are scoped exactly as they are today.

## 4. Non-goals

- **Data isolation between organisations** — explicitly out of scope; use separate
  deployments (ADR-038). No `organisation_id` on scoped tables, no RLS.
- **Two-tier administration / super-admin elevation** — a single admin tier
  manages organisations; there is nothing isolated to elevate across.
- **Users in multiple organisations** — a user belongs to at most one.
- **Per-organisation billing / metering** (future).

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `Organisation` | `packages/domain/src/entities/organisation.ts` | new | An internal audience; a sharing scope, not an isolation boundary. |
| `OrganisationResolution` | `packages/domain/src/entities/organisation-resolution.ts` | new | Pure mapping: profile / email / nomination → organisation decision. |
| `core_users.organisationId` | domain user entity | existing (add field) | Nullable; the user's organisation. |
| `FlowVisibility` | `packages/domain/src/entities/flow.ts` | existing (add variant) | Gains `{ kind: "organisation" }`. |

## 6. User stories

1. As an admin, I create organisations "Procurement" and "HR" and assign each user to one.
2. As a flow author in "HR", I publish an onboarding flow to my organisation; every HR user sees it, nobody in Procurement does (unless it is also global).
3. As an end user, my flow list shows my private flows, my groups' flows, my organisation's flows, and global flows together.
4. As an admin, I rename an organisation; existing memberships and org-published flows follow the rename with no data migration.
5. As an admin, I delete an empty organisation; deleting one with members is guarded (members must be reassigned or cleared first).
6. As an admin, I choose "email domain" resolution and map `procurement.acme.com` → Procurement; matching users are placed automatically on sign-in.
7. As an admin, I choose "SSO claim" and name the attribute carrying the organisation; unseen values create a new organisation (policy permitting).
8. As an admin, I choose "self-nomination"; a first-time user creates or joins an organisation, bounded by an allowlist.

## 7. Pages / surfaces affected

- `/admin/organisations` — **new**: create / rename / delete organisations.
- `/admin/settings` — **new** resolution card: pick the membership strategy
  (`admin` / `sso_claim` / `email_domain` / `self_nomination`) and its config
  (claim name / domain→org map / nomination mode + allowlist).
- User-admin surface — **extended**: an organisation selector per user, beside
  the existing role/team fields (used under the `admin` strategy).
- First-sign-in flow — **extended**: a nomination prompt when strategy is
  `self_nomination`.
- Flow visibility control — **extended**: an "Organisation" option beside
  Private / Group / Everyone.
- Flow-listing queries — **extended**: include flows whose owner shares the
  viewer's organisation and whose visibility is `organisation`.

No changes to the unit-of-work, repositories' isolation behaviour, sessions,
uploads, audit, or any background job.

## 8. Database changes

| Table | Change | Prefix valid? |
| ----- | ------ | ------------- |
| `core_organisations` | NEW — `id`, `name`, `slug`, `created_at`, `updated_at` | yes (`core_`) |
| `core_users` | add `organisation_id uuid` nullable, FK → `core_organisations(id)` `on delete set null` | n/a |
| `admin_system_settings` | `OrganisationResolution` JSON (runtime config, no DDL) | n/a |

No other table is altered. No `organisation_id` on scoped tables; no RLS. The
`email_domain` map and `self_nomination` allowlist live inside the config JSON and
reference organisation ids inline — no new tables.

## 9. Architectural decisions

- **ADR-038** (Accepted) — organisation is an internal sharing/visibility scope
  extending ADR-036; one table + one nullable column + one `FlowVisibility`
  variant; membership admin-assigned; no isolation, no RLS, no elevation.
- **ADR-037** (Superseded) — pooled RLS isolation; retained for history only.
- Assumes ADR-036 (groups / visibility ladder) and ADR-021 (admin).

## 10. Acceptance criteria

- [ ] With no organisations and all users unaffiliated, all existing tests pass and behaviour is unchanged.
- [ ] An admin can create, rename, and delete an organisation; deleting one with members is rejected until they are reassigned.
- [ ] An admin can assign a user to an organisation and clear it back to unaffiliated (under the `admin` strategy).
- [ ] Each resolution strategy places a first-time user in the correct organisation: `sso_claim` (claim → org, unseen creates per policy), `email_domain` (mapped verified domain, `onUnmatched` honoured), `self_nomination` (create-or-join within allowlist).
- [ ] A flow set to `organisation` visibility is listed for users sharing the owner's organisation and not for others (unless separately global/grouped).
- [ ] A user with a null organisation sees no `organisation`-scoped flows and their own flows behave as today.
- [ ] No scoped table gains an `organisation_id` column; no RLS policy is introduced.

## 11. Out of scope / future work

- Data isolation between organisations (separate deployments instead); multi-org
  users; per-org admins; per-org billing; denormalising `organisation_id` onto
  `app_flows` as a list optimisation.

## 12. Risks / open questions

- **Over-sharing a flow** — a missed visibility check could list an
  organisation-scoped flow to the wrong viewer. Blast radius is a workflow
  *definition* becoming discoverable, not a session/document data leak (those stay
  owner-scoped). Mitigation: the org rung reuses the same tested visibility
  resolution as `group`/`global`, with unit tests per rung.
- **Delete semantics** — deleting an organisation must not orphan users
  confusingly; `on delete set null` returns members to unaffiliated, and the UI
  guards deletion of a non-empty organisation.
- **Not isolation** — the one thing to communicate clearly in docs/UI: publishing
  to an organisation controls *who can find the flow*, not who can see any data
  produced by running it.
- **Email-domain edge cases** — shared domains (gmail.com), multiple domains per
  organisation, unverified emails; the admin-maintained map + a verified-email
  requirement are the guardrails, exactly as they would be for isolation.
