# Implementation Summary — v0.1.2

## Version Bump

PATCH: `0.1.1 → 0.1.2`

## What Was Built

Fixed a bug where the admin dev-login endpoint returned an HTML error page
instead of a JSON error when the session insert failed, causing the login page
to display `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

## Files Modified

- `apps/web/src/app/api/dev-login/route.ts` — wrapped `db.insert(core_sessions)`
  in a try/catch that returns `{ error: "Failed to create session." }` with
  status 500 instead of letting the exception propagate.
- `VERSION` — bumped to `0.1.2`
- `package.json` — bumped version to `0.1.2`

## Known Limitations

None. The underlying cause (e.g., missing migration) still needs to be resolved
separately via `pnpm db:migrate` if tables do not exist.
