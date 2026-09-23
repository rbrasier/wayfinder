# Phase — Organisation Branding and Sign-in Notice

- **Status**: Implemented in 0.28.24 — see `org-branding-and-login-notice.summary.md` alongside
- **Target version**: 0.28.24 — **PATCH** (0.28.23 → 0.28.24). No schema change.
- **Base branch**: `release/alpha-2`. This is a **deliberate maintainer
  override** of CLAUDE.md's "new features land on `main`" rule. The feature has
  no schema impact, and trial organisations on alpha-2 need it. It reaches
  `main` by the normal forward-merge. When built, it is filed under
  `docs/development/implemented/alpha-2/v0.28.24/`.
- **PRD**: `docs/development/prd/org-branding-and-login-notice.prd.md`
- **ADR**: `docs/development/adr/060-install-wide-branding-and-theme-tokens.adr.md`
- **Depends on**: ADR-041 (DB-first runtime config), ADR-038, ADR-033.
- **Issue**: #304 (split from #302)

## 1. Goal

An install admin can upload a logo, set a display name, and set one brand
colour from Admin → Settings. The colour is contrast-checked and recolours the
whole UI from first paint. The admin can also configure a blocking sign-in
notice (`off` by default, `once` per version, or `every_sign_in`), whose
acknowledgements are recorded in the audit log. With nothing configured, the
product is unchanged.

## 2. Approved change summary

**Headline.** Admins can brand a Wayfinder install from Admin → Settings. They
can upload a logo, set a display name that replaces the "Wayfinder" text, and
choose one brand colour that recolours the whole UI. The colour is checked for
contrast before it can be saved. The same settings area also gets a blocking
sign-in notice, which the admin can set to show once per notice version or on
every sign-in. Each acknowledgement is written to the audit log. There's one
brand for the whole install and no schema change, planned as patch 0.28.24 on
`release/alpha-2`.

**Note applied at approval:** the sign-in notice defaults to `mode: "off"`.

- **Business rules**
  - With no branding set, the UI is unchanged.
  - A logo replaces the "W" tile, and a display name replaces "Wayfinder". The
    Alpha/Admin badge always stays.
  - Text on the brand colour is chosen automatically. Saving is rejected if the
    colour is below 4.5:1 against `#faf9f7`.
  - Logos must be PNG, JPEG or WebP up to 512 KB, checked from the file's
    contents; SVG is rejected.
  - In `once` mode the sign-in notice blocks until the current version is
    acknowledged; in `every_sign_in` mode it blocks once per sign-in session.
    Each acknowledgement is audited.
- **UI**
  - A Branding card and a Sign-in notice card in Admin → Settings.
  - The palette is applied on the server, so the default blue never flashes.
  - Signed-out pages are branded.
  - The sign-in notice is a modal that can't be dismissed.
- **Data**
  - `BrandingConfig` and `LoginNoticeConfig`, each stored as a settings row.
  - `BrandPalette`, derived from the brand colour and never stored.
  - The `login_notice.acknowledged` audit action.
- **Database**
  - None.
- **Risks**
  - The colour sweep is large, about 230 occurrences.
  - The audit lookup has no index to use.
  - Settings are cached per process.
  - A broken blocking modal could lock users out.
- **Out of scope**
  - Per-organisation branding, a secondary colour, dark theme, favicon, and
    branded emails and documents.
  - SVG logos.
  - An index on the audit log.
  - Changing the Site Banner or Chat disclaimers.

## 3. What is built

| Layer | File(s) | Change |
| ----- | ------- | ------ |
| domain | `entities/colour-contrast.ts` (+ test) | `parseHexColour`, `relativeLuminance`, `contrastRatio`, `pickReadableForeground` (`#ffffff` vs `#1c1b19`), `BRAND_TEXT_CONTRAST_MINIMUM = 4.5`, `PAGE_BACKGROUND_COLOUR = "#faf9f7"`. |
| domain | `entities/branding.ts` (+ test) | `BrandingConfig`, `BrandPalette`, `DEFAULT_BRAND_PALETTE` (today's literal hexes), `deriveBrandPalette`, `createDefaultBrandingConfig`, `parseBrandingConfig(raw, fallback)`, `BRANDING_CONFIG_SETTING_KEY`, `BRANDING_LOGO_MIME_TYPES`, `BRANDING_LOGO_MAX_BYTES = 512 * 1024`, `BRANDING_DISPLAY_NAME_MAX = 40`, `sniffLogoMimeType(bytes)` (magic bytes → MIME or null). |
| domain | `entities/login-notice.ts` (+ test) | `LOGIN_NOTICE_MODES = ["off", "once", "every_sign_in"]`, `LoginNoticeConfig`, `createDefaultLoginNoticeConfig()` (`mode: "off"`, `text: ""`, `version: 0`), `parseLoginNoticeConfig`, `nextLoginNoticeVersion(previous, incomingText)`, `isLoginNoticeDue(config, acknowledgements, authSessionId)`, `LOGIN_NOTICE_CONFIG_SETTING_KEY`, `LOGIN_NOTICE_ACKNOWLEDGED_ACTION`. |
| domain | `index.ts` | Export the above. |
| application | `use-cases/branding/upload-branding-logo.ts` (+ test) | Sniff, size-check, `IObjectStorage.put` under `branding/logo-<version>`, delete the previous key, persist config, audit `branding.logo_updated`. |
| application | `use-cases/branding/remove-branding-logo.ts` (+ test) | Delete the object, null `logo`, audit `branding.logo_removed`. |
| application | `use-cases/branding/set-branding.ts` (+ test) | Validate display name and colour (contrast rule), preserve `logo`, persist, audit `branding.updated`. |
| application | `use-cases/login-notice/set-login-notice.ts` (+ test) | Bump version on a text change, persist, audit `login_notice.updated`. |
| application | `use-cases/login-notice/get-login-notice-status.ts` (+ test) | `off` → `{ due: false }` with **no** audit query; otherwise `IAuditQueryRepository.search({ actorId, action })` → `isLoginNoticeDue`. |
| application | `use-cases/login-notice/acknowledge-login-notice.ts` (+ test) | Write `login_notice.acknowledged` with `{ version, authSessionId }`; reject if the notice is `off` or the version is stale. |
| adapters | `config/runtime-config-store.ts` (+ test) | `getBrandingConfig`/`invalidateBranding`, `getLoginNoticeConfig`/`invalidateLoginNotice`, same cache + pending pattern as `getSiteBannerConfig`. |
| adapters | `auth/session-resolver.ts`, `auth/cached-session-resolver.ts` (+ tests) | `ResolvedSession` gains `sessionId` (`core_sessions.id`). Never the token. |
| apps/web | `server/trpc.ts` | Carry `authSessionId` on the authenticated context. |
| apps/web | `server/routers/settings-presentation.ts` | `getBranding` (public), `setBranding`, `getLoginNotice`, `setLoginNotice` (admin), `getLoginNoticeStatus`, `acknowledgeLoginNotice` (authenticated). Zod reuses `hexColourSchema`. |
| apps/web | `app/api/branding/logo/route.ts` | `GET` (public, config-keyed, `nosniff`, immutable cache on `?v=`), `POST` multipart and `DELETE` (admin). |
| apps/web | `lib/container.ts` | Wire the new use cases. |
| apps/web | `app/layout.tsx` | Read branding server-side; render the `:root` palette `<style>`. |
| apps/web | `components/branding/brand-mark.tsx` (+ component test) | One brand block (logo or "W" tile, display name or "Wayfinder", badge slot) used by `sidebar.tsx` and `(auth)/layout.tsx`. |
| apps/web | `components/settings/branding-card.tsx` (+ component test) | Upload/preview/remove, display name, colour picker + hex input, live ratio with icon + text, Save disabled on fail. |
| apps/web | `components/settings/login-notice-card.tsx` (+ component test) | Mode setting, text, "editing re-prompts everyone" note. |
| apps/web | `components/login-notice/login-notice-gate.tsx`, `login-notice-state.ts` (+ tests) | Non-dismissable modal; pure state function for "open?"; mounted in `(user)/layout.tsx` and `(admin)/admin/layout.tsx`, ahead of the organisation/welcome gates. |
| apps/web | `app/(admin)/admin/settings/page.tsx` | Add both cards. |
| apps/web | `styles/globals.css`, `tailwind.config.ts` | Add `--primary-hover` / `wf.primary-hover`; the palette `<style>` overrides the existing tokens. |
| apps/web | ≈ 80 files under `src/` | Token sweep: see §5. |
| root | `validate.sh` | Fail on any primary-ramp literal in `apps/web/src`. |

## 4. Database changes

None. `admin_system_settings` gains two keys (rows, not DDL). `core_audit_log`
gains new `action` values. No migration, so no `-- data-impact:` declaration.

## 5. Token sweep

Counted on `release/alpha-2` at 0.28.23 (case-insensitive, `.ts`/`.tsx`/`.css`
under `apps/web/src`):

| Literal | Occurrences / files | Replace with |
| ------- | ------------------- | ------------ |
| `#2f56d3` | 153 / 73 | `wf-primary` utilities or `var(--wf-primary)` |
| `#1f3ea8` | 10 / 8 | `wf-primary-hover` / `var(--primary-hover)` |
| `#eaeefb` | 42 / 26 | `wf-primary-light` / `var(--primary-light)` |
| `#c3cef2` | 22 / 14 | `wf-primary-dim` / `var(--primary-dim)` |
| `rgba(47, 86, 211, …)` | 2 | `color-mix(in srgb, var(--wf-primary) N%, transparent)` |

Rules:
- Replace only primary-ramp uses. The existing `wf-purple`, `wf-teal` and
  other semantic colours are untouched.
- `components/ui/button.tsx` is swept first. It is the widest-reaching single
  file, and its default and `link` variants must take `text-[var(--primary-foreground)]`
  so a dark foreground works on a light brand colour.
- Sweep in small commits by directory, so a visual regression is easy to trace
  back.
- The `validate.sh` check lands **after** the sweep, in the same PR.

## 6. Implementation order (tests first)

1. Domain: `colour-contrast.ts`, then `branding.ts` (`deriveBrandPalette` sweep
   test; `DEFAULT_BRAND_PALETTE` equals today's hexes), then `login-notice.ts`
   (`isLoginNoticeDue` table test over mode × version × session).
2. Adapters: runtime-config getters/invalidators; `ResolvedSession.sessionId`.
3. Application use cases and their tests (fakes for storage, settings and
   audit).
4. apps/web server: tRPC procedures, logo route, container wiring,
   `authSessionId` on the context.
5. Root-layout palette injection plus the `BrandMark` component; swap it into
   the sidebar and auth layout.
6. Token sweep (§5), then the `validate.sh` literal check.
7. Settings cards.
8. `LoginNoticeGate` in both layouts.
9. `./validate.sh` green. Bump `VERSION` and root `package.json` to `0.28.24`.

## 7. Test plan

- **Unit (domain):**
  - Contrast maths against published WCAG reference pairs.
  - `pickReadableForeground` is ≥ 4.5:1 for every colour that passes the
    background rule.
  - `deriveBrandPalette` is deterministic; the default palette is the constant.
  - Magic-byte sniffing covers PNG, JPEG, WebP, SVG, GIF and truncated input.
  - Version bumping; `isLoginNoticeDue`.
- **Unit (application):**
  - Upload rejects oversize files, SVG and spoofed extensions.
  - Upload deletes the previous key.
  - `off` never queries the audit log.
  - Acknowledging a stale version is rejected.
  - The token never reaches the audit payload.
- **Adapter:** `RuntimeConfigStore` caching and invalidation for both keys;
  `sessionId` is resolved.
- **Component:**
  - The branding card disables Save and shows the ratio on a failing colour.
  - `BrandMark` renders the logo `<img alt>` or falls back to the "W" tile.
  - The notice modal ignores Escape and backdrop clicks.
- **E2E:** consult `docs/guides/e2e-test-policy.md`. The sign-in notice gating
  entry to the app is a candidate: it's an auth-adjacent blocking flow that
  can't be proven below the browser. Branding and colour are covered by unit
  and component tests.

## 8. ADR required

ADR-060 (above). It assumes ADR-041, ADR-038 and ADR-033.

## 9. Risks / open questions

Carried from PRD §12:
- The breadth of the colour sweep.
- The unindexed audit lookup (a MINOR follow-up if it becomes slow).
- The per-process config cache.
- Lock-out if the blocking modal breaks.

Also: confirm at build time that Better Auth's `core_sessions.id` is stable for
the life of a sign-in session and isn't rotated when the session refreshes. If
it is rotated, `every_sign_in` would re-prompt mid-session. Check this in
`node_modules`, not from memory.

## 10. Approved build summary (/build Step 0, 2026-09-23)

Built as specified in §§1–9, with these build-time decisions:

- **Branch / PR:** `claude/issue-304-triage-ngk6v0` → `release/alpha-2`
  (maintainer override of `/build`'s `feature/…` off `main`).
- **Session-id stability verified:** Better Auth 1.6.25 refreshes a session by
  updating `expiresAt`/`updatedAt` keyed on the token, so `core_sessions.id` is
  stable for the whole sign-in session (§9's open question is closed).
- **Size ceilings:** `runtime-config-store.ts` (648 lines) and `container.ts`
  (779) are near the 800-line limit, so the two new settings use a small
  `config/cached-setting.ts` helper, and the wiring lives in
  `lib/container-presentation.ts`.
- **Web tests are pure model/state tests.** `apps/web` has no React testing
  library, so the card, brand-mark and gate logic is extracted into
  `*-model.ts` / `*-state.ts` files and unit-tested there, rather than with the
  component tests §7 describes.
- **Sign-in prompt ordering:** `sign-in-prompts.tsx` gains a
  `loginNoticeCleared` flag, and the organisation and welcome gates wait on it.
  ADR-060 records that it amends ADR-056 §4. The `(admin)` layout has no
  organisation or welcome gate, so the notice gate mounts there on its own.
- **E2E:** a new `branding.spec.ts` covers logo upload (policy group 3). The
  sign-in notice gets **no** e2e, because turning it on applies install-wide
  and would block every parallel spec on the shared CI database. It is covered
  by the application use-case tests and `login-notice-state.test.ts`.

Build order:
1. contrast domain
2. branding domain
3. sign-in notice domain
4. branding use cases
5. notice use cases
6. adapters
7. web server wiring
8. logo route
9. palette injection and BrandMark
10. token sweep and validate check
11. settings cards
12. notice gate and prompt ordering
13. e2e and wrap-up
