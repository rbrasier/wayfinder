# v1.48.1 Implementation Summary

## What was built

Alpha-readiness UI touches:

1. A subtle `Alpha` badge next to the "Wayfinder" wordmark in the sidebar
   header (both the desktop sidebar and the mobile drawer) to signal the app's
   pre-release state.
2. A `?` help button fixed to the top-right of every authenticated page. It
   toggles a small dropdown (styled like the existing chat-actions menu) with:
   - **Report an issue** → the GitHub issues page for this repo
     (`https://github.com/rbrasier/wayfinder/issues`).
   - **Contact developers** → a Google Form, defaulting to
     `https://forms.gle/QWZQEnFViErRZSNU8` and overridable via the
     `NEXT_PUBLIC_CONTACT_FORM_URL` environment variable.

## Files created

- `apps/web/src/components/help-menu.tsx` — the `HelpMenu` client component
  plus the pure `resolveContactFormUrl` helper and the `GITHUB_ISSUES_URL` /
  `DEFAULT_CONTACT_FORM_URL` constants.
- `apps/web/src/components/help-menu.test.tsx` — tests for the component export
  and the env-override / default / whitespace-trim behaviour of
  `resolveContactFormUrl`.

## Files modified

- `apps/web/src/components/sidebar.tsx` — added the `Alpha` badge in the
  desktop and mobile headers.
- `apps/web/src/app/(user)/layout.tsx` and
  `apps/web/src/app/(admin)/admin/layout.tsx` — render `<HelpMenu />` so it
  appears on every page.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` and
  `apps/web/src/app/(user)/chats/_content.tsx` — added right padding to the
  full-height page headers so their right-aligned controls don't sit beneath
  the fixed help button.
- `.env.example` — documented `NEXT_PUBLIC_CONTACT_FORM_URL`.
- `VERSION` / `package.json` — version bump.

## Tests

`apps/web/src/components/help-menu.test.tsx` covers the new behaviour:
the contact-form URL falls back to the Google Form default when the env var is
unset/blank, uses the override when provided (trimmed), and the GitHub issues
URL targets the repo. The test environment is smoke-test only (no jsdom), so
the menu's interaction is not exercised via Playwright; the link-resolution
logic — the only non-trivial behaviour — is covered by unit tests.

## Migrations

None. No DB, domain, application, or adapter changes — pure web UI.

## Known limitations

The GitHub issues URL is hardcoded to `rbrasier/wayfinder`; only the contact
form is env-overridable (per request).

## Version bump

PATCH: 1.48.0 → 1.48.1
