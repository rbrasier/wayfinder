# Implementation Summary — Organisation Branding and Sign-in Notice (v0.28.25)

- **Version**: 0.28.25 — **PATCH**. The maintainer chose PATCH on the alpha-2
  line over the MINOR on `main` that the branching rules would normally give a
  new feature. There is no schema change. It was planned as 0.28.24; #303 merged
  into `release/alpha-2` first and took that number, so this ships as 0.28.25.
- **Base branch**: `release/alpha-2` (alpha-2 line)
- **Phase doc**: [`org-branding-and-login-notice.phase.md`](./org-branding-and-login-notice.phase.md)
- **PRD**: `docs/development/prd/org-branding-and-login-notice.prd.md`
- **ADR**: `docs/development/adr/060-install-wide-branding-and-theme-tokens.adr.md`
  (amends ADR-056 §4)
- **Issue**: #304 (split from #302)

## What was built

**Branding.** Admin → Settings → General now has a **Branding** card:
- An admin can upload a logo (PNG, JPEG or WebP, up to 512 KB). It replaces the
  "W" tile in the sidebar and above the sign-in, register and reset-password
  forms.
- An optional display name replaces "Wayfinder" beside the mark.
- One brand colour recolours the whole UI.
- A live WCAG readout shows the colour's contrast against the page background.
  Save is disabled below 4.5:1, and the server enforces the same rule with the
  same wording.
- Text on the brand colour is chosen automatically.
- The palette is rendered server-side as `:root` overrides in the root layout,
  so a branded install never flashes Wayfinder blue.

With nothing configured, nothing changes: no `<style>` block is rendered, and
the tokens keep today's values.

**Colour sweep.** For the brand colour to reach the whole UI, every hard-coded
primary-ramp colour in `apps/web/src` was replaced with a token:
- 192 Tailwind classes across 63 files
- 6 white-on-primary fills, which now use `text-wf-primary-contrast`
- 17 SVG illustration fills and strokes
- the session-card progress colour and 3 CSS rules

Colours that only coincide with Wayfinder blue but encode data now use a named
`DATA_INDIGO` constant. These are the step colour picker's "Indigo", the default
step colour, and the chart palettes. `validate.sh` check 24 fails if a literal
comes back.

**Sign-in notice.** Admin → Settings → Notifications has a **Sign-in notice**
card:
- **Mode:** `off` (the default), `once` (until the wording changes) or
  `every_sign_in`.
- **Blocking:** the notice is a modal with no close button that Escape and
  outside clicks can't dismiss. It blocks the `(user)` and `(admin)` layouts
  until the user clicks "I understand".
- **Audit:** each acknowledgement is a `login_notice.acknowledged` audit event
  carrying the notice version and the sign-in's `core_sessions.id`. The token is
  never recorded. Those events are also how the gate decides whether the notice
  is due.
- **Re-asking:** changing the wording bumps the version, so everyone is asked
  again.
- **Ordering:** the organisation and welcome-tour prompts now wait for the
  notice.

## Files created

| File | Purpose |
|---|---|
| `packages/domain/src/entities/colour-contrast.ts` (+ test) | WCAG 2.1 luminance/contrast, readable-foreground choice. |
| `packages/domain/src/entities/branding.ts` (+ test) | `BrandingConfig`, `DEFAULT_BRAND_PALETTE`, palette derivation, colour/name validation, logo magic-byte sniffing, tolerant parse. |
| `packages/domain/src/entities/login-notice.ts` (+ test) | `LoginNoticeConfig`, version bump, `isLoginNoticeDue`, audit-row → acknowledgement. |
| `packages/application/src/use-cases/branding/*` (+ test) | `SetBranding`, `UploadBrandingLogo`, `RemoveBrandingLogo`, shared read/write helper. |
| `packages/application/src/use-cases/login-notice/*` (+ test) | `SetLoginNotice`, `GetLoginNoticeStatus`, `AcknowledgeLoginNotice`. |
| `packages/application/src/use-cases/__fixtures__/presentation-doubles.ts` | In-memory settings, object storage and audit log for both specs. |
| `packages/adapters/src/config/cached-setting.ts` (+ test) | One cached settings row; keeps `runtime-config-store.ts` under the size ceiling. |
| `packages/adapters/src/config/runtime-config-store-presentation.test.ts` | Getters/invalidators for the two new settings. |
| `apps/web/src/app/api/branding/logo/route.ts` (+ test) | Public GET (config-keyed, `nosniff`, sandbox CSP, immutable only for the current `?v=`); admin POST/DELETE. |
| `apps/web/src/lib/container-presentation.ts` | Wires the six use cases; keeps `container.ts` under the ceiling. |
| `apps/web/src/lib/public-branding.ts` | The branding view any visitor may see (no storage key). |
| `apps/web/src/lib/brand-style.ts` (+ test) | The `:root` override block, or null when unbranded. |
| `apps/web/src/lib/data-colours.ts` | `DATA_INDIGO` for data encodings that must not follow the brand. |
| `apps/web/src/components/branding/brand-mark.tsx`, `brand-mark-model.ts` (+ test) | Logo-or-tile and name, shared by sidebar and auth layout. |
| `apps/web/src/components/settings/branding-card.tsx`, `branding-card-model.ts` (+ test) | The Branding card and its live contrast check. |
| `apps/web/src/components/settings/login-notice-card.tsx` | The Sign-in notice card. |
| `apps/web/src/components/login-notice/login-notice-gate.tsx`, `login-notice-state.ts` (+ test) | The blocking modal and its show/clear rules. |
| `apps/web/src/server/routers/settings-presentation.test.ts` | Public view hides the key; input schemas. |
| `apps/web/e2e/branding.spec.ts` | e2e policy group 3 (file upload). |

## Files modified

- **domain**: `entities/index.ts`.
- **application**: `use-cases/index.ts`.
- **adapters**:
  - `config/runtime-config-store.ts` gets the branding and sign-in notice
    getters.
  - `auth/session-resolver.ts` gets `sessionId` (from `core_sessions.id`).
  - Two auth test files were updated for `sessionId`.
- **apps/web, server**:
  - `server/trpc.ts` and `server/server-context.ts` add `authSessionId` to the
    context. Five test context helpers were updated for it.
  - `server/routers/settings-presentation.ts` adds six procedures.
  - `lib/container.ts` spreads in the new builder.
- **apps/web, layouts**:
  - `app/layout.tsx` injects the palette and calls `connection()`, so it renders
    per request.
  - `app/(auth)/layout.tsx` renders `BrandMark`.
  - `app/(user)/layout.tsx` and `app/(admin)/admin/layout.tsx` prefetch branding
    and notice status and mount the gate.
  - `app/(admin)/admin/settings/page.tsx` adds the two cards.
- **apps/web, components and styles**:
  - `components/sidebar.tsx` uses `BrandMark`.
  - `components/layout/sign-in-prompts.tsx` adds `loginNoticeCleared`, and
    `organisation-sign-in-gate.tsx` and `welcome-tour-gate.tsx` wait on it.
  - `styles/globals.css` adds `--primary-hover` and `--primary-contrast`,
    removes the hard-coded colours, and fixes the run-progress sweep.
  - `tailwind.config.ts` adds `wf-primary-hover` and `wf-primary-contrast`.
  - `app/app-icons.test.ts` now asserts the token default rather than a class.
  - About 80 component files had their hard-coded colours swept to tokens.
- **root**: `validate.sh` (check 24), `VERSION`, `package.json`.

## Migrations

None. Both settings are rows in `admin_system_settings`, and acknowledgements
are rows in `core_audit_log`.

## Tests

- New unit tests:
  - domain: 59
  - application: 35
  - adapters: 13
  - web: 11 (logo route), 4 (router), 4 (brand style), 4 (brand mark),
    7 (branding card), 14 (notice state)
- The `app-icons` test was rewritten for the token.
- Full suite at the final `validate.sh`:
  - domain 810, application 1,007, adapters 790, web 1,004, api 18,
    shared 11, mocks 107
  - All passing.
- **e2e:** `branding.spec.ts`, policy group 3. It covers uploading a logo that
  then shows in the app and on the signed-out `/login`, rejecting a
  renamed SVG while keeping the existing logo, and removing the logo to bring
  back the W tile. Written, not run; CI runs it.
- **No e2e for the sign-in notice,** even though it's group 1. It applies to the
  whole install, and turning it on would block every spec running in parallel
  against the shared CI database. It's covered at the application layer (the
  status and acknowledgement round trip, stale versions, audit failure) and by
  `login-notice-state.test.ts` (show and clear rules, including standing aside
  when the lookup fails).

## Deviations from the approved summary

- **Logo version.** It's the upload time in milliseconds, not a counter. A
  counter would reuse a version after remove and re-upload, and the immutable
  cache would then show the old image. ADR-060 §4 now records this.
- **Colour sweep scope.** Colours that encode data (the "Indigo" option, default
  step colour, chart palettes) were **not** switched to the brand token. They
  use `DATA_INDIGO` instead, and ADR-060 now says why.
- **`CachedSetting` on a failed read.** It serves the defaults but does not
  cache them, unlike the older getters, so a database blip at startup can't pin
  Wayfinder's look for the life of the process.
- **Sign-in notice lookup failure.** If the status lookup fails, the gate stands
  aside rather than blocking. It's a governance aid, and an outage must not lock
  everyone out.
- **Web component tests.** These are pure model and state tests, because
  `apps/web` has no React testing library (as approved).

## Known limitations

- **Unindexed audit lookup.** The notice-status query filters `core_audit_log`
  by actor, action and resource id without an index. It runs once per full page
  load, and only while the notice is on. An `(actor_id, action)` index is a
  MINOR follow-up, since it needs a migration.
- **Per-process cache.** Like every runtime setting, a change only reaches
  other replicas when their cache is invalidated or they restart.
- **Favicon and emails.** The favicon and emails still carry Wayfinder's
  branding. They're out of scope.
- **Not checked visually.** No infrastructure (Postgres, Redis, MinIO) was
  available in this session, so no page was rendered in a browser. The
  Tailwind output was checked, and every new utility class (`wf-primary-*`,
  `fill-`, `stroke-`, `accent-`, `outline-`) was confirmed to be generated.
