# PRD — Admin "View as User" (Simulated Session)

- **Status**: Draft
- **Date**: 2026-09-15
- **Author**: rbrasier
- **Target version**: 0.37.0  (bump: MINOR — see `docs/guides/versioning.md`)
- **Issue**: [#295](https://github.com/rbrasier/wayfinder/issues/295)

## 1. Problem

When a user reports that a chat, an approval or a generated document "looks
wrong", an admin has no way to see the screen that user is seeing. The only
options today are to ask for the user's password — which nobody should do — or
to reconstruct the user's state from the database by hand. Both are slow, and
neither shows the actual rendered surface, which is often where the problem is.

Issue #295 asked for "a logout button or switch account feature … to assist with
testing when using multiple accounts". Signing out already works, from the
account popup at `apps/web/src/components/sidebar.tsx:577`. What is missing is
the ability for an admin to *be* another user for a few minutes.

## 2. Users / Personas

- **Wayfinder admin (support / debugging)** — needs to reproduce a reported
  problem on the reporter's own screen, with the reporter's own permissions,
  data and flows, without holding their credentials.
- **The simulated user** — needs assurance that anything an admin does under
  their name is attributable to the admin who did it, permanently and
  tamper-evidently.

## 3. Goals

- An admin can start viewing as any other user in two clicks from the account
  popup, without that user's password and without signing out.
- While simulating, the app renders exactly what the target user would see: their
  chats, their approvals, their permissions, their admin status (or lack of it).
- The admin always knows they are simulating — a banner is visible on every
  screen for the whole duration, and states whose account is being viewed.
- Returning to the admin's own account is a single click and always succeeds;
  the admin's own session is never at risk.
- Every audited action taken during a simulated session names both the account it
  was taken under and the admin who actually took it.

## 4. Non-goals

- Self-service account switching between two accounts the same person owns (the
  multi-session reading of issue #295).
- Impersonation from `apps/api` or any non-web surface.
- An admin-facing report or audit search filter for "everything done under
  impersonation".
- Any change to sign-in, sign-out, password reset, or the ADR-035
  concurrent-session limit.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `ImpersonationTicket` | `packages/domain/src/entities/impersonation-ticket.ts` | new | `{ targetUserId, impersonatorId, startedAt, expiresAt }`. Pure value object; carries `isImpersonationExpired` and `extendImpersonation`. |
| `AuditActorContext` | `packages/domain/src/entities/audit-actor-context.ts` | new | `{ userId, impersonatorId }` — the value carried through the request-scoped actor store (ADR-060). |
| `ResolvedSession` | `packages/adapters/src/auth/session-resolver.ts:11` | existing, extended | Gains `impersonatorId: string \| null`. |
| `CachedPrincipal` | `packages/adapters/src/auth/cached-session-resolver.ts` | existing, extended | Must carry `impersonatorId` or the cache would erase it on the second request. |
| `TrpcContext` | `apps/web/src/server/trpc.ts:9` | existing, extended | Gains `impersonatorId: string \| null`. |
| `AuditLog` | `packages/domain/src/entities/audit-log.ts` | existing, unchanged | Impersonator rides `metadata`; no new field, so `computeAuditHash`'s input shape is untouched. |

## 6. User stories

1. As an admin, I can open my account popup and click "View as user" beneath
   Sign out, so that I can start debugging without leaving my own account.
2. As an admin, I can search a list of users in a modal and pick one, so that I
   can find the person who reported the problem in an install with many users.
3. As an admin, once I pick a user I land on `/chats` rendered as them, so that I
   see the screen they described rather than a description of it.
4. As an admin, I can see at all times that I am simulating, who I am simulating,
   and how many minutes remain, so that I never mistake their account for mine.
5. As an admin, I can extend the simulated session from the banner when 30
   minutes is not enough, so that a long debugging session is not cut off
   mid-task.
6. As an admin, I can click "Return to your account" and be myself again
   immediately, so that I can never be stranded in someone else's account.
7. As a compliance reviewer, I can see in the audit log that an action was taken
   under a user's name by a named admin, so that impersonated activity is never
   anonymous.

## 7. Pages / surfaces affected

- `apps/web/src/components/sidebar.tsx` — a "View as user" item in the account
  popup, directly beneath Sign out, rendered only when `user.isAdmin` and only
  when not already simulating.
- New modal component — user picker with a search filter.
- `apps/web/src/app/layout.tsx` — the impersonation banner, rendered beside
  `SiteBanner` inside the flex column so it subtracts from viewport height rather
  than overlaying the app.
- `/chats` — the landing route after starting a simulated session.
- tRPC: `impersonation.start`, `impersonation.stop`, `impersonation.extend`,
  `impersonation.current`, `impersonation.listTargets` — all added.
- `apps/web/src/server/trpc.ts` — context resolution and the actor scope.
- `apps/web/src/middleware.ts` — no change; the admin's own session cookie is
  still present throughout, so the existing cookie check still passes.

## 8. Database changes

None.

Attribution rides `core_audit_log.metadata` (jsonb), which `computeAuditHash`
already folds into the hash chain — so an impersonator recorded there is exactly
as tamper-evident as one in a dedicated column, with no migration and no
`-- data-impact:` declaration. See ADR-060 for why a column and a
`core_impersonation_sessions` table were both rejected.

## 9. Architectural decisions

- **New** — ADR-059: Impersonation is a layered session, not a substituted one.
- **New** — ADR-060: Audit attribution uses a request-scoped actor context.
- **Assumes** — ADR-033 (immutable audit log): metadata is inside the hash, and
  `core_audit_log` stays append-only and unaltered by this feature.
- **Assumes** — ADR-035 (admin session lifecycle controls): a simulated session
  creates no `core_sessions` row, so it counts against nobody's concurrency limit
  and is invisible to the idle/absolute timeout logic.
- **Assumes** — ADR-021 (admin bypass in permission resolution): while
  simulating, permissions resolve for the *target*, so an admin simulating a
  non-admin loses the bypass.

## 10. Acceptance criteria

- [ ] "View as user" appears in the account popup for an admin and is absent for
      a non-admin.
- [ ] The picker lists other users and never lists the calling admin.
- [ ] `impersonation.start` rejects a non-admin caller with `FORBIDDEN`.
- [ ] `impersonation.start` rejects the caller's own id with a validation error.
- [ ] After starting, `trpc.user.me` returns the target's id, name, email and
      permissions, and the target's `isAdmin`.
- [ ] After starting, the browser lands on `/chats`.
- [ ] The banner is visible on every authenticated route while simulating, names
      the target, shows whole minutes remaining, and is absent when not
      simulating.
- [ ] The banner's Extend button resets the remaining time to the full TTL and
      writes an `impersonation.extended` audit row.
- [ ] "Return to your account" clears the cookie; the next request resolves as
      the admin, with `isAdmin` true again.
- [ ] A ticket past `expiresAt` resolves as the admin, not the target, with no
      error shown.
- [ ] A tampered or unsigned impersonation cookie is ignored entirely and
      resolves as the admin.
- [ ] An impersonation cookie presented without a valid admin session resolves as
      nobody — it is never an authentication credential on its own.
- [ ] An impersonation cookie whose `impersonatorId` does not match the live
      session's user id is refused.
- [ ] Starting writes `impersonation.started` with `actor_id` = the admin;
      stopping writes `impersonation.stopped`.
- [ ] An audited write made during a simulated session has `actor_id` = the
      target and `metadata.impersonatorId` = the admin.
- [ ] An audited write made outside a simulated session has no `impersonated` key
      in its metadata.
- [ ] Two concurrent requests — one simulated, one not — do not leak each other's
      actor context.
- [ ] `./validate.sh` passes.

## 11. Out of scope / future work

- An impersonation report, and the `AuditQueryFilter` extension that would let an
  admin search for impersonated activity directly. `AuditQueryFilter`
  (`packages/domain/src/entities/audit-query.ts:12`) has no metadata filter and
  `core_audit_log` has no index that would serve one, so this is its own phase.
- A server-side list of currently-active simulated sessions, which would need the
  `core_impersonation_sessions` table this PRD declines to add.
- Restricting impersonation by group or delegated-admin scope (ADR-036).
- A read-only simulation mode.

## 12. Risks / open questions

- Full read/write under another user's name means audit metadata is the only
  thing distinguishing those actions. If the actor context is not stamped on a
  write path, attribution is lost silently rather than loudly — ADR-060 §4 states
  the mitigation.
- The impersonation cookie is a second credential. A signing or expiry-validation
  flaw is a privilege-escalation path, so it must be signed with the same secret
  discipline as the session cookie and never trusted from the client.
- Any audit write outside a request scope — a background job, a webhook, a queue
  worker — records no impersonator. This is correct (those are not impersonated)
  but must be stated so it is not mistaken for a gap.
- Better Auth's own admin/impersonation plugin is deliberately unused. Any Better
  Auth API shape the build touches must be verified in `node_modules`, not
  recalled.
- `packages/application` must not learn about impersonation. If a use case needs
  the impersonator, that is a signal the actor context is in the wrong place.
