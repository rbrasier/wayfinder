# Bug fix — a User Admin could grant admin access through a custom role

- **Severity**: Major
- **Base**: `release/alpha-2`, shipping in v0.28.47
- **Source issue**: none

## Symptom

ADR-066 §3 says only a Global Admin decides who holds admin access. A delegated
User Admin (`admin:users`) could get round that whenever a Global Admin had
created a custom role that grants an admin area key (`admin:technical`,
`admin:users` or `admin:oversight`):

- **Assign or remove it** — including on their own account. Assigning yourself a
  custom role holding `admin:oversight` opens every user's chats and flows.
- **Take over its holders** — edit their email, reset their password or delete
  them, then sign in as that person and inherit their admin access.

## Reproduction

1. As a Global Admin, create a role "Oversight" on `/admin/roles` and tick
   *Admin oversight* for it.
2. Sign in as a user who holds only the seeded User Admin role.
3. Call `role.assignUser` with your own user id and the Oversight role id.
4. `{"ok":true}` — the User Admin now holds `admin:oversight`. The same call
   with the seeded Technical Admin role is correctly refused (403).

Verified against a running app on `release/alpha-2` at `f8f7e6f`.

## Root cause (verified)

Every delegated-admin check asks `isAdminRoleKey(role.key)`
(`packages/domain/src/entities/role.ts`), which recognises only the three
built-in role keys — `admins`, `technical_admins`, `user_admins`. What a role
*grants* is never looked at, so a custom role carrying an admin area key is
treated as an ordinary role by:

- `AssignUserRole` and `RemoveUserRole` (`packages/application/src/use-cases/role/`)
- `refuseAdminAccountForDelegate` (`packages/application/src/use-cases/admin-account-guard.ts`),
  used by `UpdateUser`, `ResetUserPassword` and `DeleteUser`

Creating roles and editing their permissions (`role.create`,
`role.updatePermissions`) are behind `adminProcedure`, so no other path lets a
User Admin attach an admin key to a role.

## Fix plan

- Add `grantsAdminAccess(roleKey, permissions)` to the domain: true for a
  built-in admin role key or for any role whose permissions include an
  `ADMIN_AREA_PERMISSIONS` key.
- `AssignUserRole` / `RemoveUserRole` read the role's permissions and refuse a
  non-Global caller when `grantsAdminAccess` holds.
- `refuseAdminAccountForDelegate` takes the `IRoleRepository` and applies the
  same test to every role the target holds; `UpdateUser`, `ResetUserPassword`
  and `DeleteUser` receive the role repository from the web container.

## Regression tests

- `packages/domain/src/entities/role.test.ts` — `grantsAdminAccess`.
- `packages/application/src/use-cases/role/role.test.ts` — a User Admin cannot
  assign or remove a custom role holding an admin area key; a Global Admin can;
  a custom role with no admin key stays assignable.
- `packages/application/src/use-cases/delegated-user-admin.test.ts` — a User
  Admin cannot update, reset or delete a holder of such a role.

No e2e spec: server-side authorisation is in none of the six groups of
`docs/guides/e2e-test-policy.md`; the regression tests are the guard.
