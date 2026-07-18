# ADR-038 — Organisations as an Internal Sharing Scope

- **Status**: Accepted (scoped by `multi-tenancy.prd.md`)
- **Date**: 2026-07-18
- **Supersedes**: **ADR-037** (runtime-toggleable pooled RLS isolation). The
  product decision that motivated 037 — *isolate several external tenants' data
  within one deployment* — has been withdrawn. See Context.

## Context

ADR-037 modelled an **organisation** as a hard **isolation boundary**: pooled
shared-schema tenancy with `organisation_id` on every tenant-scoped table,
Postgres RLS as a defence-in-depth backstop, a per-request tenant context and
GUC, an audited super-admin elevation path, and three sign-in org-resolution
strategies. It is the largest, highest-blast-radius change in the enterprise set.

That machinery only earns its cost when the organisations sharing a deployment
are **mutually-distrusting external tenants** — where org A reading org B's
sessions, uploads, documents, or audit trail is a compliance breach.

The product decision is now explicit and narrower:

1. Organisations are **internal audiences of a single operator** (a department,
   business unit, or client team inside one deployment), not external customers.
2. The need is **scoped flow publishing and discovery** — "publish this flow to
   my team / my organisation / everyone" — not per-tenant data isolation.
3. An operator who genuinely requires isolated data runs a **separate
   deployment**. Isolation is a deployment concern, not an in-app feature.

Under (1)–(3), organisation is not an isolation boundary at all. It is a
**sharing boundary**, one step coarser than an ADR-036 group. Wayfinder already
has the machinery: `FlowVisibility` is `private | global | group`, and
`core_users` already carries a free-text `team` column. An organisation is
`team` promoted to a first-class entity, plus one more rung on the existing
visibility ladder.

## Decision

### 1. Organisation is a sharing/visibility boundary (extends ADR-036)

An organisation groups users into an internal audience. It carries **no data
isolation semantics**. Sessions, messages, uploads, generated documents,
knowledge-base content, usage events, and the audit log remain scoped exactly as
they are today (by owner, participant, or deployment), unchanged by this ADR. The
conceptual ladder, widest-last, is:

```
private → group (ADR-036) → organisation (this ADR) → global
```

Group stays a *within-deployment* delegated-sharing set (ADR-036); organisation
is a coarser, identity-assigned audience above it.

### 2. Minimal schema: one new table, one new column

- **`core_organisations`** — `id`, `name`, `slug`, `created_at`, `updated_at`.
- **`core_users.organisation_id uuid` (nullable)** — the user's organisation.
  `null` means *unaffiliated*, and behaves identically to the current
  single-org-implicit app. No other table gains a column.

No `organisation_id` is added to any tenant-scoped table. No RLS policies, no
tenant context, no unit-of-work GUC, no super-admin elevation path.

### 3. `organisation` visibility resolves through ownership, not a stored column

`FlowVisibility` gains a fourth variant:

```
FlowVisibility =
  | { kind: "private" }
  | { kind: "group"; groupIds: string[] }
  | { kind: "organisation" }
  | { kind: "global" }
```

A flow published with `{ kind: "organisation" }` is visible to users whose
`organisation_id` equals the **flow owner's** `organisation_id`. Listing resolves
this by joining `app_flows.owner_user_id → core_users.organisation_id` and
comparing against the viewer's organisation — so no `organisation_id` is
denormalised onto `app_flows`. Per-user `permissions` (owner/viewer) continue to
work orthogonally, as they do for every other visibility kind.

### 4. Membership is admin-assigned, not sign-in-resolved

A user's organisation is set by an administrator in the existing user-admin
surface, exactly as `role` and `team` are set today. The three sign-in
resolution strategies from ADR-037 (`sso_claim`, `email_domain`,
`self_nomination`) are **dropped**: they solved "which external tenant does this
stranger belong to," which is out of scope. Auto-assignment (e.g. by verified
email domain) may return later as a small convenience enhancement, but is not
part of this decision.

### 5. Administration is a single tier

There is no deployment-super-admin vs. per-org-admin split. The existing admin
(ADR-021) manages organisations through a CRUD screen and assigns users to them.
Because organisation carries no isolation, there is nothing to elevate across.

### 6. Additive and reversible

Every change is additive. With `organisation_id` null everywhere (the state
immediately after migration) behaviour is identical to today. There is no
enable/disable toggle, no backfill, and no disable-guard — an organisation is
just data an admin creates and assigns when they want the extra sharing rung.

## Alternatives considered

- **Pooled RLS isolation (ADR-037).** Correct for external, mutually-distrusting
  tenants; rejected here as vastly over-scoped for internal audiences. Its own
  "application-filter-only isolation" alternative described exactly this sharing
  model and rejected it *for the isolation use case* — that rejection no longer
  applies, because isolation is no longer a goal.
- **Schema-per-tenant / separate databases.** Rejected in 037 and still rejected;
  operators needing true isolation take a separate deployment instead, which is
  simpler than either in-app option.
- **Three sign-in resolution strategies.** Rejected — admin assignment mirrors
  the existing `team` field and needs no IdP-claim or domain-map machinery.
- **Denormalising `organisation_id` onto `app_flows`.** Considered as a
  list-query optimisation; deferred. The owner-join is correct and avoids a
  column that would need maintaining if a flow owner changes organisation.

## Consequences

**Positive**

- Collapses the largest phase in the enterprise set to one table, one nullable
  column, and one visibility variant. No RLS, GUC, tenant context, elevation,
  backfill, or per-table leak tests.
- Reuses the existing `FlowVisibility` union and ADR-036 group/permission
  machinery; the new rung is symmetric with the ones already shipped.
- Fully additive — null organisation reproduces today's behaviour, so it lands as
  a 2.x MINOR with no contract change.

**Negative / accepted limits**

- **No data isolation.** Users in different organisations can still see each
  other's sessions and uploads where today's owner/participant rules already
  allow it; organisation governs *flow discovery*, nothing more. Operators who
  need isolated data must run separate deployments — this is the explicit trade.
- A missed visibility check could over-share a **flow** (not a session — those
  stay owner-scoped). The blast radius is a discovery leak of a workflow
  definition, not a cross-tenant data breach, which is acceptable for internal
  audiences and no worse than the existing `group`/`global` rungs.
