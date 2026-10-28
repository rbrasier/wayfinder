# Bug fix — better-auth advisories fail the audit gate on alpha-2

Source: red Security scan in CI. No issue.
Severity: blocker. `scripts/audit-check.sh` fails `./validate.sh` and CI on every PR to `release/alpha-2`.

## Symptom

```sh
./scripts/audit-check.sh
# high     — better-auth — GHSA-q84f-53jg-9ppm — Device login approval does not show the requesting client or permissions
# high     — better-auth — GHSA-r4xp-prcw-77qf — OAuth Proxy lets an attacker sign in as another user
# critical — better-auth — GHSA-965c-763c-88jm — OAuth state can be used as a Magic Link to sign in as another user
```

## Root cause

The root `pnpm.overrides` held better-auth at `>=1.6.22 <1.7.0` (1.6.25 resolved). All three advisories
list `<1.7.7` / `<1.7.0-rc.3` as vulnerable, with no 1.6.x backport (1.6.33 is still in range), so the
only fix is the 1.7 line. Wayfinder does not use the magicLink, oAuthProxy or deviceAuthorization
plugins, but the advisories count against the package, and `scripts/waiver-check.mjs` rejects
waiving an advisory that has a fix within the major already in use.

### What the upgrade breaks: Entra account identity

better-auth 1.7 changes how an OAuth account is identified. A provider now declares
`accountSubject`, and the mapped user may no longer carry an `id`. For Microsoft that subject is the
id token's **`oid`**, where 1.6 stored **`sub`** in `core_accounts.account_id`. 1.7 offers no option
to override it.

Left alone, no existing Entra row would match after the upgrade. 1.7 would fall back to the email
match (Microsoft is a trusted provider), add a second `microsoft` account row, and run
`applyEntraPrecedence` again, signing the user out of their other sessions. A user whose Entra email
has changed since they first linked would get a duplicate user.

## Fix

- Root override `better-auth` → `>=1.7.7 <1.8.0`. `apps/web` and `packages/adapters` move to
  `~1.7.14`. Lockfile regenerated; only the better-auth family moved.
- `entra-user-info.ts` (the id-token reader used whenever a custom Entra authority is configured)
  no longer returns `user.id`. It returns `null` when the token has no `oid`, the same as better-auth's
  stock Microsoft provider, instead of failing later with a generic account-subject error.
  `better-auth.ts` types the decoded claims as `MicrosoftEntraIDProfile`.
- Migration `0049_entra_account_id_oid.sql` (data only, no schema change) rewrites `account_id` from
  `sub` to `oid` for each `microsoft` row, decoding the oid from the row's own stored `id_token`.
  It is per-row and fault-tolerant:
  - A row with no token, an undecodable token or no `oid` is left as it is. Its next sign-in falls
    back to email relinking.
  - A row whose `oid` is already held by another row is left as it is, so the change cannot collide.
  - Re-running the migration does nothing.

## Regression guard

- `audit-check.sh` exits 1 before the change and 0 after (only the waived zod 3 entry is listed).
- `entra-user-info.test.ts`: the user carries no `id`, the `oid` is passed through in `data`, and a
  token with no `oid` returns `null`. `mock-fidelity.test.ts` asserts the mock Entra token carries an
  opaque `oid`. Both failed before the implementation change.
- Migration verified by hand on a scratch Postgres 16 `core_accounts` table. The full migration chain
  needs pgvector, which isn't installed here. Cases checked:
  - A valid token (including a non-ASCII name) is rewritten.
  - Rows with a null token, a malformed token, no oid or an already-taken oid are left untouched.
  - The credential row is untouched.
  - A second run makes no changes.
- `./validate.sh` passes.

**E2E:** no new spec. `fix-entra-account-linking.spec.ts` already signs in through the mock Entra
server, which emits `oid`, and runs in CI. It covers the 1.7 sign-in and linking path.

## Known limitations

- Entra rows with no stored id token keep their `sub`. Their next sign-in relinks by email, creating
  one extra account row and one session revocation.
- The low-severity `GHSA-44jh-23m7-hpcf` (drizzle-adapter rate limits) is also fixed by 1.7.14.
