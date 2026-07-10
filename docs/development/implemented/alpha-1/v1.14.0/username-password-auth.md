# Username / password authentication via Better Auth

## Problem

The template shipped with magic-link as the only configured Better Auth
mechanism. Magic-link required wiring a working email provider before anyone
could sign in, and the Better Auth Drizzle adapter was never given a schema
map — so even with `sendMagicLink` set, queries would have failed to resolve
the `user` / `session` / `verification` models against the prefixed table
names (`core_users`, `core_sessions`, `core_verification_tokens`). The
`/api/dev-login` route worked around this by bypassing Better Auth and
inserting sessions directly. There was no register flow at all.

## Behaviour change

- Authentication is now **email + password**. The email address acts as the
  username; there is no separate username field.
- `AUTH_METHOD` enum loses `magic-link` and `pki-and-magic-link` and gains
  `email-password` (the new default) and `pki-and-email-password`.
- `/admin/register` is a new public page. Anyone can self-register an account;
  new users get `is_admin = false`. The first user who registers with
  `ADMIN_SEED_EMAIL` is promoted to admin by the existing `seedAdmin` hook
  (no behavioural change there).
- A new system setting `registration_enabled` (default `true`) gates the
  register page. Admins can toggle it from `/admin/settings`. When off, the
  register page shows a "Registration disabled" notice instead of the form.
- `/admin/login` is now an email + password form. The dev-login bypass
  (development only) is preserved as a separate button on the same page.
- The middleware bypass list now includes `/admin/register` alongside
  `/admin/login`.

## Affected entities

None at the domain level — `User` keeps the same shape.

## Affected use cases

None. Better Auth manages the credential side internally via its own
`account` model; existing use cases (`CreateUser`, `UpdateUser`, etc.) still
write to `core_users` only.

## DB changes

Migration `0010_certain_ikaris.sql`:

```sql
CREATE TABLE "core_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "password" text,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamp with time zone,
  "refresh_token_expires_at" timestamp with time zone,
  "scope" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "core_sessions" ADD COLUMN "ip_address" text;
ALTER TABLE "core_sessions" ADD COLUMN "user_agent" text;
ALTER TABLE "core_users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;
ALTER TABLE "core_users" ADD COLUMN "image" text;
ALTER TABLE "core_accounts" ADD CONSTRAINT "core_accounts_user_id_core_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."core_users"("id") ON DELETE cascade;
```

The new `core_accounts` table holds Better Auth's credential records — one row
per (user, provider) pair. For email/password sign-ups the row has
`provider_id = "credential"`, `account_id = user.id`, and `password = <hashed>`.
The OAuth columns are nullable so the same table can carry Google / GitHub /
etc. rows in the future without a further migration.

`email_verified` and `image` on `core_users` are required by Better Auth's
default `user` model. The new `ip_address` / `user_agent` columns on
`core_sessions` are populated by Better Auth on sign-in but are not used by
any application code today.

## API / UI changes

- **Better Auth wiring** (`packages/adapters/src/auth/better-auth.ts`):
  - Dropped the `magicLink` plugin.
  - Replaced `AuthMethod`'s `magic-link` / `pki-and-magic-link` variants
    with `email-password` / `pki-and-email-password`. The latter two no
    longer carry a `sendMagicLink` callback.
  - Passed an explicit `schema` map to `drizzleAdapter` so Better Auth's
    `user` / `session` / `account` / `verification` models bind to
    `core_users` / `core_sessions` / `core_accounts` /
    `core_verification_tokens`. Without this the adapter resolves no
    tables and every query throws.
  - Added `fields` overrides for each model so Better Auth's camelCase
    field names (`emailVerified`, `userId`, `accessToken`, ...) translate
    to the project's snake_case columns. `verification.value` is mapped
    to the existing `token` column so the verification-token table can
    stay as-is.
  - Enabled `emailAndPassword` with `autoSignIn: true` and
    `requireEmailVerification: false`.

- **tRPC** (`apps/web/src/server/routers/settings.ts`):
  - `settings.registrationEnabled` — public query, returns
    `{ enabled: boolean }`. Reads `registration_enabled` from
    `admin_system_settings`; defaults to `true` when unset.
  - `settings.setRegistrationEnabled` — admin mutation, persists the flag.

- **Pages**:
  - `apps/web/src/app/(admin)/admin/login/page.tsx`: replaced magic-link
    form with `email` + `password` fields backed by
    `authClient.signIn.email`. Dev-login button preserved.
  - `apps/web/src/app/(admin)/admin/register/page.tsx` (new): name +
    email + password + confirm-password form backed by
    `authClient.signUp.email`. Checks `settings.registrationEnabled`
    before rendering; shows a notice when disabled.
  - `apps/web/src/app/(admin)/admin/settings/page.tsx`: new
    `RegistrationToggleCard` controls the flag.

- **Middleware** (`apps/web/src/middleware.ts`): bypasses
  `/admin/register` (as well as `/admin/login`) so the page is reachable
  before auth, and the PKI-redirect set was renamed to
  `pki-and-email-password`.

- **Auth client** (`apps/web/src/lib/auth-client.ts`): removed the
  `magicLinkClient` plugin — email/password uses Better Auth's built-in
  `signIn.email` / `signUp.email`.

- **Env** (`.env.example`, `apps/web/src/lib/env.ts`): `AUTH_METHOD` enum
  updated; comments and the default flipped to `email-password`.

## Why no `ADMIN_SEED_PASSWORD`

The original request mentioned a default admin password env var, but during
clarification we opted for the lighter approach: the first user to register
with `ADMIN_SEED_EMAIL` gets promoted to admin (existing `seedAdmin`
behaviour). This keeps secret-handling out of `.env`, avoids a chicken-and-egg
hashing step at boot, and reuses the existing seed pathway unchanged.
