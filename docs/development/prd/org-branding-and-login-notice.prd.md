# PRD — Organisation Branding and Sign-in Notice

- **Status**: Accepted — implemented in 0.28.24
- **Date**: 2026-09-23
- **Author**: Claude Code (for @rbrasier), from issue #304 (split from #302)
- **Target version**: 0.28.24 (bump: **PATCH** — see §9 and the phase doc for
  why this ships on `release/alpha-2` rather than `main`)

## 1. Problem

Organisations trialling Wayfinder want the product to carry their own logo and
brand colour. Today every install shows the same "W" tile, the "Wayfinder"
wordmark and Wayfinder blue, and nothing in the admin UI or configuration can
change that. Separately (#302), operators want a notice every user must
acknowledge after signing in — the existing Chat disclaimer is tied to starting
a chat, not to signing in, and the Site Banner cannot be acknowledged.

## 2. Users / Personas

- **Install admin** — configures the install's look and its sign-in notice from
  Admin → Settings, without a redeploy.
- **Every user** — sees the brand on signed-out pages and throughout the app,
  and acknowledges the sign-in notice when one is due.
- **Auditor / compliance reviewer** — needs evidence of who acknowledged which
  version of the sign-in notice, and when.

## 3. Goals

- An admin can upload a logo (PNG, JPEG or WebP, ≤ 512 KB) that replaces the
  "W" tile in the sidebar and on the sign-in, register and reset-password pages.
- An admin can set a display name that replaces the "Wayfinder" wordmark in
  those same places.
- An admin can set one brand colour that replaces Wayfinder blue everywhere it
  appears as the primary colour — buttons, links, focus rings, the brand tile,
  and the primary accents in canvas, tour and reports.
- A brand colour that cannot be read as link text on the page background
  (< 4.5:1, WCAG 2.1 AA) cannot be saved; text placed on the brand colour is
  always readable because its colour is chosen automatically.
- The brand applies on first paint — no flash of Wayfinder blue.
- An admin can configure a blocking sign-in notice with mode `off` (default),
  `once` (per notice version) or `every_sign_in`.
- Every acknowledgement of the sign-in notice is written to the tamper-evident
  audit log with the notice version.
- With nothing configured, the product looks and behaves exactly as it does
  today.

## 4. Non-goals

- Per-organisation branding. Organisations are an internal sharing scope
  (ADR-038), not tenants, and the sign-in page has no organisation to brand by.
- A second (secondary/accent) configurable colour, custom fonts, a dark theme,
  a custom favicon.
- Branding emails or generated documents.
- SVG logos (script-injection surface; see ADR-060).
- Changing the existing Site Banner or Chat disclaimers.

## 5. Key entities

| Entity | Lives in | New / existing | Notes |
| ------ | -------- | -------------- | ----- |
| `BrandingConfig` | `packages/domain/src/entities/branding.ts` | new | `{ displayName, primaryColour, logo: { key, mimeType, version } \| null }`; stored as JSON under `BRANDING_CONFIG_SETTING_KEY`. |
| `BrandPalette` | `packages/domain/src/entities/branding.ts` | new | Derived from `primaryColour`: base, hover, light, dim, ring, `primaryHsl`, `foreground`. Never stored. |
| Colour-contrast helpers | `packages/domain/src/entities/colour-contrast.ts` | new | `relativeLuminance`, `contrastRatio`, `pickReadableForeground` — pure WCAG 2.1 maths. |
| `LoginNoticeConfig` | `packages/domain/src/entities/login-notice.ts` | new | `{ mode: "off" \| "once" \| "every_sign_in", text, version }`; stored under `LOGIN_NOTICE_CONFIG_SETTING_KEY`. Default `mode: "off"`. |
| `AuditLog` (`login_notice.acknowledged`) | `core_audit_log` | existing | New action; metadata `{ version, authSessionId }`. |
| `ResolvedSession` | `packages/adapters/src/auth/session-resolver.ts` | existing | Gains `sessionId` (`core_sessions.id`) for `every_sign_in`. |

## 6. User stories

1. As an install admin, I can upload our logo and see it replace the "W" tile
   in the sidebar and on the sign-in page, so users recognise our deployment.
2. As an install admin, I can set a display name, so the wordmark reads as our
   product name rather than "Wayfinder".
3. As an install admin, I can pick our brand colour and see the contrast ratio
   live, and I'm stopped from saving a colour our users can't read.
4. As an install admin, I can remove the logo or clear the colour and get the
   Wayfinder defaults back.
5. As an install admin, I can turn on a sign-in notice that every user must
   acknowledge — once per wording, or on every sign-in.
6. As a user, after signing in, I see the notice and must click "I understand"
   before I can use the app; I'm not asked again until it's due.
7. As an auditor, I can filter the audit log by `login_notice.acknowledged` and
   see who acknowledged which version and when.

## 7. Pages / surfaces affected

- `/admin/settings` — new **Branding** card and **Sign-in notice** card.
- `(auth)/layout.tsx` — sign-in, register, reset-password: brand block reads
  the branding config.
- `components/sidebar.tsx` — brand block reads the branding config.
- Root `app/layout.tsx` — injects the derived palette as CSS custom properties
  server-side.
- `(user)/layout.tsx` and `(admin)/admin/layout.tsx` — mount `LoginNoticeGate`.
- `GET /api/branding/logo?v=<version>` — **new, public**; streams the configured
  logo.
- `POST /api/branding/logo`, `DELETE /api/branding/logo` — **new, admin only**;
  upload and remove.
- tRPC (in `settings-presentation.ts`):
  - `settings.getBranding` (public), `settings.setBranding` (admin)
  - `settings.getLoginNotice` (admin), `settings.setLoginNotice` (admin)
  - `settings.getLoginNoticeStatus` (authenticated) — `{ due, text, version }`
  - `settings.acknowledgeLoginNotice` (authenticated)
- `apps/web/src` styling — every primary-ramp literal replaced with a token:
  `#2f56d3` (153 occurrences / 73 files), `#1f3ea8` (10 / 8), `#eaeefb`
  (42 / 26), `#c3cef2` (22 / 14) and `rgba(47, 86, 211, …)` (2) — ≈ 230
  occurrences, counted on `release/alpha-2` at 0.28.23.

## 8. Database changes

None. Both configs are rows in the existing `admin_system_settings` table
(ADR-041). Acknowledgements are rows in the existing `core_audit_log`. The logo
binary lives in object storage behind `IObjectStorage`. No migration.

## 9. Architectural decisions

- Assumes ADR-041 (DB-first runtime config), ADR-038 (organisations are a
  sharing scope), ADR-033 (append-only, hash-chained audit log).
- **New: ADR-060 — Install-wide branding and theme tokens** (scope, palette
  derivation, contrast rule, logo storage/serving, sign-in notice
  acknowledgement via the audit log).
- **Release-line override:** CLAUDE.md routes new features to `main`. The
  maintainer has deliberately chosen to ship this on `release/alpha-2` as a
  PATCH (0.28.23 → 0.28.24), because it has no schema change and trial
  organisations on alpha-2 need it. It reaches `main` through the normal
  forward-merge.

## 10. Acceptance criteria

Branding
- [ ] With no primary colour set, the palette is the `DEFAULT_BRAND_PALETTE`
      constant — exactly today's `#2f56d3` / `#1f3ea8` / `#eaeefb` / `#c3cef2` —
      not a derivation, so every surface renders identically to today.
- [ ] `apps/web/src` contains none of the primary-ramp literals listed in §7
      (case-insensitive); a check in `validate.sh` fails if one is reintroduced.
- [ ] `setBranding` rejects a `primaryColour` whose contrast against `#faf9f7`
      is < 4.5:1, with an error naming the measured ratio.
- [ ] `pickReadableForeground` returns whichever of `#ffffff` / `#1c1b19` has
      the higher contrast; the result is ≥ 4.5:1 for every colour that passes the
      rule above (unit-tested over a colour sweep).
- [ ] Logo upload accepts PNG/JPEG/WebP ≤ 512 KB, sniffed from magic bytes;
      rejects SVG, any other type, and oversize files with a specific message.
- [ ] `GET /api/branding/logo` returns 404 when no logo is set, serves only the
      configured key (no caller-supplied path), and sets `Content-Type` from the
      stored MIME, `X-Content-Type-Options: nosniff`, and a long `Cache-Control`
      keyed on `?v=`.
- [ ] Replacing a logo deletes the previous object and bumps `logo.version`;
      removing it deletes the object and restores the "W" tile.
- [ ] The palette is present in the server-rendered HTML (no client-side
      flash); saving branding updates it on the next navigation without a
      redeploy.
- [ ] The display name (max 40 chars) replaces "Wayfinder" in the sidebar and
      auth layout; the Alpha/Admin badge is unchanged; the logo `<img>` has
      `alt` set to the display name (or "Wayfinder").
- [ ] Setting and clearing branding each write an audit event.

Sign-in notice
- [ ] Default config is `mode: "off"`; with `off`, no gate renders and no audit
      query runs.
- [ ] Saving a changed `text` increments `version`; saving the same text does not.
- [ ] `once`: the notice is due until an acknowledgement exists for the user at
      the current version.
- [ ] `every_sign_in`: the notice is due until an acknowledgement exists for the
      user at the current version **and** the current `core_sessions.id`.
- [ ] The modal cannot be closed by Escape, backdrop click, or a close button;
      "I understand" writes the audit event and closes it.
- [ ] The gate renders in both the `(user)` and `(admin)` layouts, and yields to
      no other modal — it shows before the organisation and welcome-tour gates.
- [ ] The raw session token never appears in audit metadata.

## 11. Out of scope / future work

- An index on `core_audit_log (actor_id, action)` — a migration, so a MINOR
  follow-up if the notice-status lookup becomes slow.
- Per-organisation branding; secondary colour; dark theme; favicon; branded
  email and document templates.
- SVG logos.

## 12. Risks / open questions

- **Token sweep breadth.** ≈ 230 occurrences across ~80 files; a missed
  literal leaves stray blue, a wrong token recolours something that isn't
  primary. Mitigated by the `validate.sh` literal check and by the default
  palette being today's hexes verbatim.
- **Audit lookup cost.** `core_audit_log` has no `actor_id`/`action` index. The
  status check runs once per sign-in session and is cached client-side for the
  session; acceptable at alpha scale.
- **Per-process cache.** Like every runtime setting, branding and notice configs
  are invalidated only in the process that saved them (ADR-041 limitation).
- **Lock-out.** A broken blocking modal would lock every user out; covered by
  tests on the gate's state function and the acknowledge path.
