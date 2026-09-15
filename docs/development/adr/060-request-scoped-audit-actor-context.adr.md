# ADR-060 — Audit Attribution Uses a Request-Scoped Actor Context

- **Status**: Proposed (scoped by `admin-view-as-user.prd.md`)
- **Date**: 2026-09-15
- **Builds on**: ADR-033 (immutable audit log and legal hold), ADR-059
  (impersonation is a layered session)

## Context

ADR-059 gives every request an `impersonatorId` alongside its `userId`. That value
has to reach `core_audit_log`, and the codebase makes this harder than it looks.

`core_audit_log` (`packages/adapters/src/db/schema/core.ts:103`) has exactly one
actor slot — `actor_id uuid` — plus `metadata jsonb`. Both are inside the hash:
`computeAuditHash` covers `{actorId, action, resourceType, resourceId, metadata, createdAt, sequence}`.
So metadata is already tamper-evident, and a new column would buy indexability at
the cost of changing the hash input shape on the one append-only table ADR-033
exists to protect — which would break verification of every existing row unless
the hash is versioned.

The harder problem is delivery. `DrizzleAuditLogger` is constructed once, in a
process-wide singleton container (`apps/web/src/lib/container.ts:778`), and the
use cases that call it are built once at boot with the logger already bound.
Almost nothing threads an actor id today — `user.resetPassword`
(`apps/web/src/server/routers/user.ts:79`) is close to the only call site that
passes `actorId` explicitly. Everything else audits from inside a use case that
has no idea who is making the request.

Three deliveries were considered:

- **Thread `impersonatorId` through use-case signatures.** Explicit, conventional,
  and a very large diff touching every use case that audits. Its real defect is
  the failure mode: a use case added later that forgets the parameter loses
  attribution silently, and nothing fails.
- **Mutate the singleton logger per request.** Fails immediately under
  concurrency. Two overlapping requests, one simulated, would cross-contaminate.
  Not viable.
- **A request-scoped store the logger reads at write time.** Node's
  `AsyncLocalStorage` propagates through awaits and is isolated per async context,
  which is exactly the shape of the problem.

There is also a question of *which* id goes in `actor_id`. Putting the admin there
would make the row disagree with the record it describes — an approval decision
would be audited against someone who is not the approver named on the approval.

## Decision

**1. `actor_id` stays the account the action was taken under.** During a simulated
session that is the target user. The audit row must agree with the artefact it
describes. This is not a loss of attribution, because of §2.

**2. The impersonator rides `metadata`.** Every audit row written inside a
simulated session carries `metadata.impersonated: true` and
`metadata.impersonatorId: <admin user id>`. Because metadata is hashed, this is as
forgery-resistant as a dedicated column. No schema change, no migration, no change
to `computeAuditHash`'s input shape, and every existing row still verifies.

**3. The context is request-scoped and read at write time.** A single
`AsyncLocalStorage<AuditActorContext>` lives in `packages/adapters`. The tRPC
context opens the scope for the request with `{ userId, impersonatorId }`;
`DrizzleAuditLogger.log` reads it and merges the impersonator keys into
`payload.metadata` before hashing. No use-case signature changes, so every present
and future audit write is covered by construction rather than by remembering.

**3a. Resolving the principal and opening the scope are one operation.** REST
routes go through a single `withPrincipal(request, handler)` helper that reads
both cookies, resolves the principal (ADR-059 §3b), opens the scope, and hands the
principal to the handler. Splitting the two would let a route resolve correctly
and forget to scope, losing attribution silently — §4's degraded case arrived at
by accident rather than by design. Fused, forgetting the scope means not having a
principal at all, which does not compile.

**4. Absence of a scope means "not impersonated", and is never an error.** A write
outside any request — a background job, a webhook handler, a queue worker, a
migration — reads an empty store and writes no impersonation keys. This is
correct, not a gap: those actions are genuinely not impersonated. The rule is that
the *absence* of the keys means "acted as themselves", and the presence of
`impersonated: true` is the only positive claim. Nothing infers impersonation from
a missing key.

**5. Explicit payload wins.** If a caller passes `metadata.impersonatorId` itself,
the context does not overwrite it. All three of `impersonation.started`,
`impersonation.stopped` and `impersonation.extended` must use this: they are the
admin's own actions and carry `actor_id` = the admin, so letting the ambient merge
reach them would stamp `impersonated: true` on a row whose actor is already the
impersonator — a row that reads as the admin impersonating themselves. The
explicit metadata is not optional on any of the three.

**6. The context is for attribution only.** No authorisation decision, anywhere,
may read the actor context. Permission checks read the tRPC context, which
resolves for the target user per ADR-059 §3. A store that could grant access would
be an ambient privilege channel, which is precisely what makes this pattern
dangerous elsewhere.

**7. `packages/application` never learns about it.** The store lives in adapters
and is read by the adapter that writes the rows. Use cases keep taking
`IAuditLogger` and keep knowing nothing. If a use case ever needs the
impersonator, that is a signal the design has drifted, not a reason to widen the
port.

## Consequences

- Attribution is automatic and total: any audit write reached from a request is
  stamped, including ones written by code that has never heard of impersonation.
- No migration, no `-- data-impact:` declaration, and the audit chain is byte-for-byte
  compatible with what is already stored.
- Querying "everything done under impersonation" is not possible from the admin
  audit search. `AuditQueryFilter`
  (`packages/domain/src/entities/audit-query.ts:12`) has no metadata filter, and
  `core_audit_log` indexes only `created_at` and `sequence`, so such a query would
  sequentially scan. The PRD names the filter as future work.
- `AsyncLocalStorage` is ambient state, which is harder to follow than a
  parameter. §6 and §7 are the guardrails that keep it from becoming a general
  context-passing mechanism; a review that finds anything else reading the store
  should treat it as a defect.
- The scope must be opened in every entry point that can audit — both tRPC context
  builders (`server/trpc.ts` and `server/server-context.ts`) and every REST route
  under `apps/web/src/app/api/`. §3a is what makes this tractable: the routes get
  it from `withPrincipal` rather than each remembering. A missed entry point
  degrades to §4 (attributed to the target, impersonator absent) rather than to a
  wrong attribution, but it is still a bug.

## Alternatives rejected

- **`core_audit_log.impersonator_id` column** — indexable, but requires folding a
  new field into `computeAuditHash` and versioning the hash so existing rows still
  verify. Too much blast radius on the append-only table for a filter the product
  does not yet need.
- **`core_impersonation_sessions` table** — solves episode listing, not
  per-action attribution; every audited write would still need the impersonator
  joined in by timestamp range, which is exactly the fragile reconstruction this
  ADR avoids.
- **Threading the id through use cases** — silent failure mode on every future
  use case, for a very large diff.
- **Mutating the shared logger per request** — unsound under concurrency.
