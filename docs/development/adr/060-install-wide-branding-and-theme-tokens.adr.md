# ADR-060 — Install-wide Branding and Theme Tokens

- **Status**: Proposed (scoped by `org-branding-and-login-notice.prd.md`)
- **Date**: 2026-09-23
- **Assumes**: ADR-041 (DB-first runtime config), ADR-038 (organisations as a
  sharing scope), ADR-033 (append-only, hash-chained audit log).
- **Numbering**: 060, not 057, because `main` already carries ADR-057–059 and
  this ADR forward-merges there from `release/alpha-2`.

## Context

Issue #304 asks for an organisation logo and brand colour, with guard rails so
a chosen colour cannot break contrast; #302 adds a notice users must
acknowledge after signing in. Five things need deciding: whose brand it is,
how a colour reaches a UI that hard-codes its primary blue, how a colour is
kept readable, how a logo is stored and served to signed-out pages, and where
"this user has acknowledged the notice" is recorded.

## Decision

### 1. One brand per install

Branding is one `admin_system_settings` row (`BRANDING_CONFIG_SETTING_KEY`),
read through `RuntimeConfigStore.getBrandingConfig()` and invalidated by
`invalidateBranding()`, exactly like the site banner.

Rejected: per-organisation branding. Organisations carry no isolation
semantics (ADR-038) — they are a discoverability scope — and the sign-in page,
the surface the issue names first, has no organisation to brand by. It would
also need columns on `core_organisations` and a migration.

### 2. One colour in, a derived palette out, delivered as CSS custom properties

The admin sets a single `primaryColour` (`#rrggbb`). The domain function
`deriveBrandPalette(hex)` returns `{ base, hover, light, dim, ring,
primaryHsl, foreground }`:

- `hover` darkens `base` in HSL lightness (today: `#2f56d3` → `#1f3ea8`);
- `light` and `dim` mix `base` towards white (today: `#eaeefb`, `#c3cef2`);
- `primaryHsl` is the `"H S% L%"` triplet the shadcn `--primary`/`--ring`
  tokens expect;
- `foreground` is `pickReadableForeground(base)` (see §3).

When no colour is set the palette is the `DEFAULT_BRAND_PALETTE` **constant**
holding today's literal values — not a derivation — so an unbranded install is
byte-for-byte unchanged regardless of rounding in the maths.

The root layout (a server component) reads the config through the container
and renders one `<style>` block overriding `--primary`, `--ring`,
`--primary-foreground`, `--wf-primary`, `--primary-hover` (new),
`--primary-light` and `--primary-dim` on `:root`. The values are produced by
the domain function from a regex-validated hex, never interpolated from raw
input, so the block cannot carry injected CSS.

Every primary-ramp literal in `apps/web/src` (`#2f56d3`, `#1f3ea8`, `#eaeefb`,
`#c3cef2`, `rgba(47, 86, 211, …)` — ≈ 230 occurrences) is replaced with the
Tailwind `wf-primary*` tokens or `var(--…)`. Translucent uses become
`color-mix(in srgb, var(--wf-primary) N%, transparent)`, the idiom globals.css
already uses. A `validate.sh` step fails on any reintroduced literal.

Rejected: fetching the palette client-side via tRPC (as the site banner does)
— every page would paint Wayfinder blue first and then swap. Rejected: a full
admin-editable palette — more inputs to get wrong, and each one needs its own
contrast rule.

### 3. Contrast is enforced on save, text colour is chosen automatically

Two rules, both WCAG 2.1 AA (4.5:1 for normal text), both pure domain
functions with unit tests:

- **Text on the brand colour** (button labels, the tile initial) uses
  `pickReadableForeground(base)`: whichever of `#ffffff` / `#1c1b19` contrasts
  more. For any colour that passes the next rule this is ≥ 4.5:1, so it needs
  no admin decision.
- **The brand colour as text** (links, `variant="link"` buttons) must reach
  4.5:1 against the page background `#faf9f7`. `setBranding` rejects a colour
  that does not, with a message carrying the measured ratio. The settings card
  runs the same function live so the admin sees the ratio before saving.

Rejected: warn-only — the issue asks for guard rails, and a saved unreadable
colour degrades every page for every user. Rejected: silently darkening the
chosen colour — the admin would get a colour they did not pick.

### 4. The logo lives in object storage and is served by one public route

Upload is a multipart `POST /api/branding/logo` (admin only). The route sniffs
magic bytes and accepts only PNG, JPEG and WebP up to 512 KB. It writes via
`IObjectStorage.put` under the fixed prefix `branding/logo-<version>`, deletes
the previous object, and stores `{ key, mimeType, version }` in the branding
row. `DELETE` removes the object and nulls `logo`.

`GET /api/branding/logo` is public, because the sign-in page is signed-out. It
reads the key from the branding config — never from the request — and streams
the object. It sends the stored `Content-Type`, `X-Content-Type-Options:
nosniff`, and `Cache-Control: public, max-age=31536000, immutable`. Consumers
request `?v=<version>`, so a replaced logo busts the cache.

Rejected: SVG. An SVG opened directly from our origin can run script. Even
with a restrictive CSP it is a second, easily-regressed security surface for a
cosmetic feature. Rejected: a base64 data URL inside the settings row — it
inflates every branding read, and the root layout reads branding on every
render.

### 5. Sign-in notice acknowledgements are audit events, not state

`LoginNoticeConfig` (`LOGIN_NOTICE_CONFIG_SETTING_KEY`) is
`{ mode: "off" | "once" | "every_sign_in", text, version }`, default
`mode: "off"`. `setLoginNotice` increments `version` whenever `text` changes.

"I understand" calls `AcknowledgeLoginNotice`, which writes
`action: "login_notice.acknowledged"`, `resource_type: "login_notice"`,
`resource_id: <version>`, `metadata: { version, authSessionId }` through
`IAuditLogger`. `GetLoginNoticeStatus` answers `due` by searching
`IAuditQueryRepository` for the user and action:

- `once` — due unless an event exists at the current `version`;
- `every_sign_in` — due unless an event exists at the current `version` **and**
  the current `authSessionId`.

`authSessionId` is `core_sessions.id`, which `ResolvedSession` gains as
`sessionId`. The session token is a bearer secret and never enters the audit
log.

The `LoginNoticeGate` mounts in both the `(user)` and `(admin)` layouts and
renders ahead of the organisation and welcome-tour gates, which wait while it
is open. It fetches status once per page load and holds the answer for the
session, so the audit query runs at most once per sign-in session per tab.

Rejected: a `core_users.login_notice_acknowledged_version` column (as ADR-056
does for the tour). It is cheaper to read, but needs a migration, and it would
duplicate what the audit log must record anyway for governance. Rejected:
`localStorage` (as the chat disclaimer does) — it is not auditable and re-asks
on every device.

## Consequences

- An unbranded install renders identically to today; the token sweep is a pure
  refactor under the default palette.
- The notice-status lookup scans `core_audit_log` by `actor_id` + `action`
  without an index. That is fine at alpha volumes. A
  `(actor_id, action)` index is the follow-up, and it is a MINOR (migration)
  change.
- Branding and notice config share ADR-041's per-process cache. A second
  replica serves the old brand until its cache is invalidated or restarted,
  the same as every other runtime setting.
- Shipping on `release/alpha-2` as a PATCH deliberately overrides the
  "features land on `main`" rule, at the maintainer's direction. It reaches
  `main` by forward-merge.
