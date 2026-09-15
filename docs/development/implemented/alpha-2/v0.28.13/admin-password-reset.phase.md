# Phase — Password Reset: Administrator-Initiated and Self-Service

- **Status**: Implemented (v0.28.13)
- **Target version**: 0.28.13  (bump: PATCH, at the maintainer's direction — see §11; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Depends on**: `BetterAuthAdminRecovery` (`packages/adapters/src/auth/admin-recovery.ts`) for the credential-write technique, `Auth.$context.password.hash` (`packages/adapters/src/auth/better-auth.ts`), the admin users page (`apps/web/src/app/(admin)/admin/users/_content.tsx`)

## 1. Problem

An administrator has no in-app way to reset another user's password. The only
path that exists is the break-glass CLI `apps/api/src/cli/recover-admin.ts`,
which requires shell and database access to the deployment — deliberately so,
because it is a lockout recovery tool, not an administration one.

The consequence is that the ordinary case — a user forgets their password, or an
account needs to be secured after a suspected compromise — has no answer in the
product. `/admin/users` offers Edit, Delete and a Power User toggle, and nothing
that touches credentials.

Self-service password change **does** already exist and works: the
`ChangePasswordModal` at `apps/web/src/components/settings/change-password-modal.tsx`
is opened from the Profile card on `/settings` and calls
`authClient.changePassword`. This phase verifies it and leaves its behaviour
unchanged.

## 2. Goals

- A "Reset password" action per row on `/admin/users`, opening a modal built from
  the same `Dialog` primitives as the rest of the site.
- The admin types a replacement password; the credential row is rewritten with
  Better Auth's own hasher so ordinary sign-in verifies it.
- The target user's sessions are all deleted, so a reset genuinely ends access.
- Every reset is attributable in the audit log: acting admin, target user, time.
- Self-service change-password confirmed present and correct; its duplicated
  client-side validation extracted into a tested pure module shared by both
  modals.

## 3. Non-goals

Emailing the user about the reset; a force-change-on-next-login flag; setting a
password at user-creation time; re-enabling email/password sign-in globally (that
is recovery's job, and an admin reaching this page is not locked out); changing
the break-glass CLI or `BetterAuthAdminRecovery`; gating the modal for
Entra/PKI-only accounts.

## 4. Approach

Mirror the layering the codebase already uses for credential writes. A new domain
port `IPasswordResetter` states the capability with no provider detail; the
adapter implements it over Better Auth exactly as `restoreCredential` does —
delete-then-insert the `credential` row in `core_accounts`, then delete the
user's `core_sessions` rows — but inside one transaction, and **without** the
auth-config change recovery performs. A `ResetUserPassword` use case resolves the
target user, delegates, and writes the audit entry.

The reset deliberately does not reuse `IAdminRecovery`: that port re-enables
email/password sign-in as a side effect and is documented as break-glass. An
everyday admin action must not silently change a deployment's auth config.

No schema change — `core_accounts` and `core_sessions` already exist and are
written through unchanged.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/ports/password-resetter.ts` | new — `IPasswordResetter`, `ResetUserPasswordInput`, `PasswordResetOutcome` |
| domain | `packages/domain/src/ports/index.ts` | export the new port |
| application | `packages/application/src/use-cases/reset-user-password.ts` | new — resolve user, delegate, audit-log |
| application | `packages/application/src/use-cases/reset-user-password.test.ts` | new — written first |
| application | `packages/application/src/use-cases/index.ts` | export the use case |
| adapters | `packages/adapters/src/auth/password-resetter.ts` | new — `BetterAuthPasswordResetter` |
| adapters | `packages/adapters/src/auth/__tests__/password-resetter.test.ts` | new — written first |
| adapters | `packages/adapters/src/index.ts` | export the adapter |
| shared | `packages/shared/src/schemas/user.ts` | add `resetUserPasswordInputSchema` |
| web | `apps/web/src/server/routers/user.ts` | add `resetPassword` admin mutation |
| web | `apps/web/src/lib/container.ts` | wire `passwordResetter` + `resetUserPassword` |
| web | `apps/web/src/components/password-form-model.ts` (+ `.test.ts`) | new — shared client-side validation |
| web | `apps/web/src/components/admin/reset-password-modal.tsx` | new — the modal |
| web | `apps/web/src/app/(admin)/admin/users/_content.tsx` | Reset password button + modal state |
| web | `apps/web/src/components/settings/change-password-modal.tsx` | use the shared validation module |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — port.** Add `IPasswordResetter` with `resetPassword(input) →
   Result<PasswordResetOutcome>`, carrying `userId` and `sessionsRevoked`.
   Relative imports only; no dependencies.
2. **Application — use case.** Test first: unknown user id → `NOT_FOUND`; a
   resetter error propagates unchanged; success writes
   `admin.user.password_reset` with the acting admin's id and the target's email.
   Then implement `ResetUserPassword`.
3. **Adapters — Better Auth implementation.** Test first against a fake `Auth`
   and a fake database: hashes through `$context.password.hash`, replaces the
   credential row, deletes sessions, reports the revoked count, and wraps a
   thrown driver error as `INFRA_FAILURE`. Then implement, running both writes in
   one transaction.
4. **Shared + router.** Add `resetUserPasswordInputSchema` (`id` uuid, `password`
   min 8) and a `resetPassword` `adminProcedure` that passes `ctx.userId` as the
   actor.
5. **Web — validation module.** Test first: `validatePasswordPair` returns a
   mismatch message, a too-short message, or `null`. Point both the new modal and
   the existing `ChangePasswordModal` at it, deleting the duplicated inline
   checks.
6. **Web — modal + row action.** `ResetPasswordModal` using
   `Dialog`/`DialogHeader`/`DialogBody`/`DialogFooter`/`DialogCloseButton`, two
   password inputs, inline `text-destructive` error, `sonner` toast on success.
   Add the button to the actions cell beside Edit and Delete.
7. **Version + validate.** Bump `VERSION` and `package.json#version` to `0.28.13`.
   Run `./validate.sh`; fix every failure. Move this doc to
   `docs/development/implemented/alpha-2/v0.28.13/` with a summary.

## 7. Acceptance criteria

- [ ] `/admin/users` shows a "Reset password" button on every row.
- [ ] The button opens a modal naming the target user, with New password and
      Confirm new password fields.
- [ ] Mismatched or under-8-character passwords are rejected inline before any
      request is sent.
- [ ] A successful reset rewrites the user's `credential` row so ordinary
      email/password sign-in accepts the new password.
- [ ] A successful reset deletes every `core_sessions` row for that user.
- [ ] A reset for a non-existent user id returns `NOT_FOUND`; the mutation is
      reachable only by an admin.
- [ ] Each reset writes an `admin.user.password_reset` audit entry naming actor
      and target.
- [ ] The reset does **not** modify the stored auth config.
- [ ] `/settings` still offers self-service change password with unchanged
      behaviour.
- [ ] Architecture intact: domain dependency-free, Result at every boundary, no
      migration.
- [ ] `VERSION` = `package.json#version` = `0.28.13`; `./validate.sh` passes.

## 8. E2E decision

**No Playwright spec.** Per `docs/guides/e2e-test-policy.md` the changed
behaviour is not in any of the six groups — it is a modal plus a mutation, whose
logic is owned by `packages/application` (authorisation, auditing, not-found) and
`packages/adapters` (hashing, credential write, session deletion), with the
client-side validation a pure module in `apps/web`. Session *deletion* here is a
database write, not the redirect-and-cookie behaviour group 1 exists for.
`apps/web` has no jsdom setup and no `.test.tsx` files, so the modal's logic is
tested as a pure module in the manner of `sidebar-model.ts`.

## 9. Risks / open questions

- Delete-then-insert on `core_accounts` leaves no credential row if it fails
  midway — mitigated by running both writes in one transaction.
- Session deletion is irreversible and applies to an admin resetting their own
  row from this page; the toast says so.
- Only the 8-character floor is enforced, matching the existing self-service
  modal — an admin can still choose a weak password.
- Entra/PKI-only accounts will gain a usable local password from a reset. That
  is the same outcome the break-glass CLI already produces and is left in place
  deliberately; restricting it is noted as follow-up, not done here.

---

## 10. Implementation summary (v0.28.13)

Delivered as planned. An administrator can now reset any user's password from
`/admin/users` without shell or database access to the deployment.

### What was verified rather than built

Self-service password change was already in place and is unchanged in behaviour.
`ChangePasswordModal` (`apps/web/src/components/settings/change-password-modal.tsx`)
is opened from the Profile card on `/settings` and calls
`authClient.changePassword` — confirmed against `better-auth@1.6.25`, where the
endpoint lives in `dist/api/routes/update-user.mjs`. Its only change here is that
its inline validation now comes from the shared module below.

### What was built

| Layer | File | Role |
|-------|------|------|
| domain | `packages/domain/src/ports/password-resetter.ts` | `IPasswordResetter`, `PasswordResetRequest`, `PasswordResetOutcome`, `MINIMUM_PASSWORD_LENGTH` |
| application | `packages/application/src/use-cases/reset-user-password.ts` | `ResetUserPassword` — length floor, user lookup, delegate, audit |
| adapters | `packages/adapters/src/auth/password-resetter.ts` | `BetterAuthPasswordResetter` — hash, replace credential, purge sessions |
| shared | `packages/shared/src/schemas/user.ts` | `resetUserPasswordInputSchema` |
| web | `apps/web/src/server/routers/user.ts` | `user.resetPassword` admin mutation |
| web | `apps/web/src/lib/container.ts` | wires the adapter and use case |
| web | `apps/web/src/components/password-form-model.ts` | `validatePasswordPair`, shared by both modals |
| web | `apps/web/src/components/admin/reset-password-modal.tsx` | the modal |
| web | `apps/web/src/app/(admin)/admin/users/_content.tsx` | Reset password row action |

`auth.$context.password.hash` was verified in `better-auth@1.6.25` at
`dist/context/create-context.mjs:181-182` — it resolves to the same hasher
sign-in verifies against, which is what makes a written row actually
authenticate.

### Tests

21 new tests, all written before their implementation:

- `packages/application/src/use-cases/reset-user-password.test.ts` — 6 tests:
  short password rejected before the resetter is called, `NOT_FOUND`, lookup
  failure propagated, no audit entry on a failed reset, audit content on
  success, and that the new password never reaches audit metadata.
- `packages/adapters/src/auth/__tests__/password-resetter.test.ts` — 8 tests:
  provider hasher used, credential row shape, delete-before-insert ordering,
  session purge and count, zero-session case, single transaction, and
  `INFRA_FAILURE` wrapping for both driver and hasher failures.
- `apps/web/src/components/password-form-model.test.ts` — 7 tests covering the
  shared validation, including the exact-minimum boundary and whitespace.

Full suite green: 3,340 tests across all packages.

### E2E

**No Playwright spec**, as planned — the behaviour is not in any of the six
groups in `docs/guides/e2e-test-policy.md`. Coverage sits in
`packages/application` and `packages/adapters`, with the client-side validation
a pure module in `apps/web`.

### Deviations from the approved plan

1. **Branch name.** Built on `claude/password-change-reset-modals-cm7pkc` rather
   than an `enhance/<slug>` branch, as required by the originating session's
   branch instruction. Base branch is unchanged: `release/alpha-2`.
2. **`ResetUserPasswordInput` renamed to `PasswordResetRequest` in the domain.**
   The planned name collided with the tRPC input type of the same name exported
   from `@rbrasier/shared`, which would have made an import from both packages
   in one file ambiguous.
3. **`ResetUserPasswordCommand.actorId` is `string | null`, not `string`.**
   `adminProcedure` checks `isAdmin` without narrowing `ctx.userId`, so the id is
   typed nullable at the router. Narrowing it would have meant rebasing
   `adminProcedure` on `authenticatedProcedure`, changing the error code from
   `FORBIDDEN` to `UNAUTHORIZED` on every admin route — too broad for a patch.
   `NewAuditLog.actorId` already models an unknown actor the same way. At runtime
   `isAdmin` is only ever true when a session resolved, so a real reset always
   records a real administrator.

### Known limitations

- `./validate.sh` reports 23 of 24 checks passing. The one failure is
  `pnpm audit`, on pre-existing high advisories in transitive dependencies
  (`jsondiffpatch`, `browserslist`, `fast-uri`). Verified identical on a clean
  tree before these changes; no dependency was added or changed here.
- An Entra- or PKI-only account gains a usable local password from a reset. This
  matches what the break-glass CLI already does and was left deliberately; a
  future change could hide the action for accounts with no credential row.
- Only the 8-character floor is enforced, so an administrator can still choose a
  weak password. Same floor the self-service form applies.
- `user.create` still creates no credential row, so a newly added user needs a
  reset before they can sign in with a password.

---

## 11. Second round (v0.28.13) — self-service reset and the sign-in flash

Three further changes on the same branch, after the base branch moved on.

### Merge with `release/alpha-2`

`origin/release/alpha-2` had advanced to `f7d12aa`, and had itself shipped
**0.28.12** for the flow-fork-recovery fix. The merge was textually clean but
carried a real collision: both lines claimed the same version. Resolved by
moving this work up to the next free patch on the line, `0.28.13`.

The base branch also brought `50dc6be`, which pins `jsondiffpatch`,
`browserslist` and `fast-uri` to patched releases. That clears the one
`validate.sh` failure recorded in §10: **all 24 checks now pass.**

### Version: PATCH, by decision

The versioning table in `CLAUDE.md` lists "new feature" under MINOR, and
self-service password reset adds a user-facing capability that did not exist
before, so MINOR was proposed. The maintainer directed PATCH instead, and this
ships as **0.28.13**.

The reading that supports it: nothing here is a new feature *area*. Email and
password sign-in, password change, and the credential store all already existed;
this completes the password-management story around them and changes no schema.
Recorded plainly so the next person reading the version history knows the call
was deliberate rather than an oversight.

### Self-service password reset (email-gated)

A user who has forgotten their password can now reset it themselves, but only
where a reset can actually complete: the entry point requires **both**
email/password sign-in and a configured mail transport.

| Layer | File | Role |
|-------|------|------|
| domain | `packages/domain/src/entities/runtime-config.ts` | `isSelfServicePasswordResetAvailable` — the two-part gate |
| application | `.../notifications/templates.ts` | `buildPasswordResetEmail` |
| application | `.../notifications/send-password-reset-email.ts` | `SendPasswordResetEmail` — refuses when unconfigured |
| adapters | `packages/adapters/src/auth/better-auth.ts` | `sendPasswordResetEmail` option, `PASSWORD_RESET_TOKEN_TTL_SECONDS`, `revokeSessionsOnPasswordReset` |
| web | `src/lib/container-auth.ts` | `buildAuthRuntime` — the auth half of the container |
| web | `src/server/routers/settings.ts` | `passwordReset` on `enabledAuthMethods` |
| web | `src/lib/password-reset.ts` | the redirect path and query params both ends agree on |
| web | `src/app/(auth)/login/forgot-password-modal.tsx` | request the link |
| web | `src/app/(auth)/reset-password/` | set the new password |

The flow is Better Auth's own, verified in `better-auth@1.6.25`
(`dist/api/routes/password.mjs`): `POST /request-password-reset` mints a
single-use token into `core_verification_tokens`, emails a link, and
`GET /reset-password/:token` validates it before redirecting to
`/reset-password?token=…` — or `?error=INVALID_TOKEN` for a stale link, which
the page renders as a dead-link message rather than failing on submit. Tokens
last one hour. `revokeSessionsOnPasswordReset` ends every live session, matching
the administrator-initiated reset.

Two decisions worth recording:

1. **The sender is wired unconditionally, not only when email is configured.**
   Better Auth only mounts the reset endpoint when a sender is present, so
   binding that to email settings looked right — but the auth instance is
   rebuilt on *auth*-config changes alone. An admin who configured email would
   have had a dead reset endpoint until the next restart. The sender refuses at
   send time instead, and the sign-in screen hides the link on the same live
   check, so an unconfigured install still offers nothing.
2. **The request form always reports the same outcome.** Whether or not the
   address has an account, the modal shows the same acknowledgement. Anything
   else would make it a way of testing which addresses are registered.

### Sign-in options no longer pop in

`/login` was entirely client-rendered and asked for `enabledAuthMethods` from
the browser, so the first paint used the query's fallbacks — password on,
Microsoft and certificate off — and the other buttons appeared once the request
came back.

The page is now a server component (`page.tsx`) that prefetches
`settings.enabledAuthMethods` and `bootstrap.adminExists` and hydrates the
client form (`login-form.tsx`), so the first paint already carries the right set
of buttons. `runtimeConfig.getAuthConfig()` is cached in-process, so this costs
no extra database work per request.

### Decomposition forced by the size ceiling

Wiring the reset sender pushed `container.ts` to 809 lines, past the 800-line
hard fail. The auth half moved to `buildAuthRuntime` in the existing
`container-auth.ts`, following the `buildOnboarding` / `buildDocumentUseCases`
pattern already in the file. `container.ts` is now 777 lines.

### Tests

18 further tests, each written before its implementation:

- `packages/domain/src/entities/runtime-config.test.ts` — 4 tests on the gate:
  true only when both halves hold, false for each half alone, false for neither.
- `.../notifications/templates.test.ts` — 6 tests: named and unnamed greeting,
  stated expiry, the "you need do nothing" line, no bare token outside the link,
  HTML escaping.
- `.../notifications/send-password-reset-email.test.ts` — 4 tests: sends to the
  requesting address, refuses when unconfigured, propagates a transport failure,
  no "null" for a nameless account.

Full suite green: 3,390 tests. `./validate.sh` passes all 24 checks.

### E2E

**Still no new spec.** The sign-in prefetch is a rendering-timing fix behind
existing specs (`phase-entra-login-auth-methods.spec.ts` and
`auth-username-password.spec.ts`), which use auto-waiting assertions and so pass
unchanged — faster, if anything. The reset flow's logic sits in the domain gate,
the template and the sender, all covered above; the parts a browser would add
are Better Auth's own endpoints.

### Deviations and open points

1. **Branch policy.** `CLAUDE.md` says release branches take bug fixes and
   enhancements but never new features. Whether self-service reset counts as a
   new feature or an enhancement of existing sign-in is the same question the
   version bump turned on; the maintainer settled both the same way, treating it
   as an enhancement, so `release/alpha-2` is the right line and the PATCH bump
   is consistent with it.
2. **A flaky test observed once.** `apps/web/src/server/approval-status-lint.test.ts`
   failed on one full-suite run and passed on every run since, alone and in the
   full suite. It spawns ESLint programmatically and was starved while seven
   packages ran concurrently under turbo. Unrelated to this diff, which touches
   neither approval status nor the ESLint config. Recorded rather than fixed.
