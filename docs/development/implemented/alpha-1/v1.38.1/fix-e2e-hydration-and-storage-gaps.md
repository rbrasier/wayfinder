# Bugfix — E2E suite: hydration console errors, selector/redirect drift, CI storage gap

## Symptoms

Running the full Playwright e2e suite surfaced failures unrelated to the
feature under test:

1. `admin-settings.spec.ts`, `smoke.spec.ts` (Admin Users) and
   `phase-user-roles-permissions.spec.ts` failed on a dev-mode React hydration
   console error.
2. `node-config-prompt-preview.spec.ts` failed with a strict-mode violation
   (two "Back to edit" controls matched one locator).
3. `fix-logout-and-register-sidebar.spec.ts` asserted a `/register` → `/admin`
   redirect, but the app intentionally redirects authenticated sessions to
   `/chats`.
4. `phase-rag-with-pgvector.spec.ts` 500'd with `Failed to store document`
   wherever no object-storage backend was running — including GitHub CI, whose
   workflow declared `MINIO_*` env vars but never started a MinIO container.

## Root causes (verified)

1. **Hydration**: Chromium injects `caret-color: transparent` onto rendered
   `<input>` elements (text, checkbox and file inputs alike) after SSR, so
   React's dev-mode hydration check logs a benign attribute mismatch. It hits
   every input on a page — the settings page alone has ~20 — so per-input
   `suppressHydrationWarning` is whack-a-mole. The mismatch never reaches a
   production build.
2. **Stale roles UI**: the roles/flags UI was refactored — there is no "Roles &
   Permissions" heading (it's split into "Roles"/"Permissions"/"Feature access"
   cards), the Admins column header is badged "locked", and per-flag role
   scoping moved off `/admin/flags` into the Roles page "Feature access" card.
   Three specs still asserted the old structure.
3. **Selector**: the preview panel exposes both an icon button with
   `aria-label="Back to edit"` and a "← Back to edit" text button; the regex
   locator matched both.
4. **Redirect**: `register/page.tsx` bounces any signed-in session to `/chats`
   (the app home). The test expectation was stale; `/chats` is the intended
   behaviour.
5. **CI storage**: `.github/workflows/e2e.yml` had `services: postgres` only —
   no MinIO — so the storage adapter had nowhere to write.

## Fix plan

- Filter the benign caret-color/fdprocessedid hydration warning centrally in the
  e2e console-capture fixture (`helpers/base.ts`) — tightly scoped so real
  hydration bugs still fail. One change covers every page instead of editing
  every input.
- Rewrite the three roles specs to the current UI ("Permissions" heading +
  matrix scoped to its table; wait for the matrix before counting locked
  checkboxes; assert role scoping in the "Feature access" card).
- Tighten the node-config locator to `{ name: 'Back to edit', exact: true }`.
- Update the register test to expect `/chats`.
- Start MinIO via `docker run` in CI (the `services:` syntax can't pass MinIO's
  `server /data` command) and signal availability with `E2E_OBJECT_STORAGE`.
- Guard the storage-writing spec with `test.skip(!process.env.E2E_OBJECT_STORAGE)`
  so it runs where storage exists (CI/MinIO, sandbox/s3rver) and skips cleanly
  elsewhere — "run what you can, skip the rest".

## Regression coverage

The existing e2e specs are the regression guard: each failed before these
changes and passes after. The storage spec is now capability-gated rather than
hard-failing in storage-less environments.

## Out of scope (left as known failures)

- `fix-prior-step-fields-stripped.spec.ts:182` (mocked template-upload pill).
- A flaky dev-mode compile timeout on the `/flows/[id]/config` route in
  `enhance-n8n-workflow-context-mapping.spec.ts`.
