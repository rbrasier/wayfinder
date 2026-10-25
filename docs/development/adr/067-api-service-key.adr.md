# ADR-067 — Service Key Authentication for the API's Management Routes

- **Status**: Accepted
- **Date**: 2026-10-25
- **Assumes**:
  - ADR-064 (flow webhook signatures — the other machine-to-machine check in `apps/api`)
  - ADR-066 (delegated admin roles — proposed; defines `AdminCaller`)
- **Numbering**: 067. 066 is reserved by the admin permission split plan.

## Context

`apps/api` mounted `/v1/users` (list, create, update, delete) with no
authentication. Anyone who could reach the API port could create an admin or
delete accounts.

Who calls it decides how to authenticate it:

- Nothing in Wayfinder does. The web app manages users through tRPC behind
  Better Auth, and `web` never calls `api` (`docs/guides/setup-aws.md`).
- The stock `docker-compose.prod.yml` publishes no port for `api`. That keeps it
  private by convention only: `restart.sh` listens on every interface, and an
  install that opens the port for the n8n callback webhook exposes every route.
- A realistic caller is therefore a script, an operator, or another service —
  never a browser. The web app's session cookie is scoped to the web origin and
  never reaches this one.

Options considered:

1. **Resolve a Better Auth session**, as `apps/web` does. Needs a cookie this
   origin never receives, or a bearer-token plugin and a token flow, for a
   caller that is not a person.
2. **Remove the routes.** Nothing calls them, but the brief asks for them to be
   authenticated, and removing an API surface is a feature decision rather than a
   stabilisation fix.
3. **A shared service key**, checked by middleware. Matches the caller and the
   API's existing machine-to-machine pattern (the n8n webhook's shared secret).

## Decision

Option 3.

- New optional env var `API_SERVICE_KEY` on `apps/api`.
- `requireServiceKey(expectedKey)` (`apps/api/src/middleware/`) runs before the
  users router. It accepts only `Authorization: Bearer <key>` (scheme
  case-insensitive). Both sides are SHA-256 hashed and compared with
  `timingSafeEqual`, so neither contents nor length leak through timing.
- Anything else is `401 { error: { code: "UNAUTHORIZED" } }`. **An unset key
  refuses every request** — an install that never configures it gets closed
  routes, not open ones, matching how the n8n webhook treats a missing secret.
- The key is one install-wide secret. There are no per-caller keys, scopes or
  rotation tooling; rotating means changing the env var and restarting.

### The caller is the system

A service key identifies no person. When ADR-066 lands and the user use cases
take an `AdminCaller`, the API passes `{ isAdmin: true, userId: null }` for a
key-authenticated request. That is deliberate rather than a placeholder: holding
the key is equivalent to holding the deployment's secrets, which already grants
full control of the install. Audit entries written for these calls name no
actor user.

## Consequences

- `/v1/users` no longer answers without the key. No Wayfinder component
  changes, because none called it.
- An operator scripting against the API sets `API_SERVICE_KEY` and sends it as a
  bearer token.
- `/v1/errors` is not covered by this decision; it is tracked separately and
  can adopt the same middleware.
- If a person-facing caller ever appears, it should authenticate as that person
  (option 1) so ADR-066's guards apply to them, rather than share this key.
