# Summary — a User Admin could grant admin access through a custom role (v0.28.47)

## Root cause

Every delegated-admin check asked `isAdminRoleKey(role.key)`, which knows only
the three built-in admin role keys. A custom role that a Global Admin gave an
admin area key (`admin:technical`, `admin:users`, `admin:oversight`) passed as an
ordinary role, so a User Admin could assign it — to themselves included — and
edit, reset the password of, or delete anyone holding it.

## Fix applied

- `grantsAdminAccess(roleKey, permissions)` in `packages/domain/src/entities/role.ts`:
  a built-in admin role key, or any role whose permissions include an
  `ADMIN_AREA_PERMISSIONS` key.
- `roleGrantsAdminAccess(role, roles)` in `admin-account-guard.ts` reads the
  role's permissions only when the key alone does not decide it.
- `AssignUserRole` / `RemoveUserRole` refuse a delegated caller on such a role.
- `refuseAdminAccountForDelegate` takes the `IRoleRepository` and refuses a
  target holding such a role; `UpdateUser`, `DeleteUser` and `ResetUserPassword`
  gain a `roles` constructor argument, wired in `apps/web/src/lib/container.ts`.
- ADR-066 §3 updated to describe the permission-based test.

## Regression tests

- `packages/domain/src/entities/role.test.ts` — `grantsAdminAccess`.
- `packages/application/src/use-cases/role/role.test.ts` — a User Admin cannot
  assign (to themselves or another) or remove a custom role holding
  `admin:oversight`; a Global Admin can; a custom role with no admin key stays
  assignable.
- `packages/application/src/use-cases/delegated-user-admin.test.ts` — a User
  Admin cannot update, delete or reset the password of a custom admin role holder.

All failed before the fix. Also verified against a running app: the self-assign
and the account edit that succeeded before now return `FORBIDDEN`.

## E2E

None. Server-side authorisation falls in none of the six groups of
`docs/guides/e2e-test-policy.md`; the regression tests are the guard.

## Deviations from the approved summary

None.

## Known limitations

- The Users page still renders Edit / Reset password / Delete on admin accounts
  for a User Admin; the server refuses them. Hiding them is a separate UX change.
