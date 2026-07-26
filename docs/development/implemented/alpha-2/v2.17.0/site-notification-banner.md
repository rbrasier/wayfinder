# Enhancement: Site-wide notification banner

An admin-controlled strip across the very top of every page — including the
signed-out sign-in screen — for notifications and site warnings. Switchable on
and off, with configurable text, point size, text colour, background colour and
an optional link. Defaults to **off**, **12pt**, **red on white**, single line,
centred. Targets `main` (the 2.x line); a banner is net-new capability, so it
does not belong on the stabilisation-only `release/alpha-1`. **MINOR** bump
(`2.16.3` → `2.17.0`) — no schema change.

Phase doc: `site-notification-banner.phase.md` (same directory).

## What changed

### Domain — the config and every rule about it

- `packages/domain/src/entities/site-banner.ts` (new) — `SiteBannerConfig`
  (`enabled`, `text`, `textSizePt`, `textColour`, `backgroundColour`, `linkUrl`,
  `linkLabel`), `createDefaultSiteBannerConfig()`, and the pure predicates the
  rest of the stack shares:
  - `normaliseSiteBannerColour` — six-digit hex only. The value lands in an
    inline `style`, so a bare keyword, a `url()` or a `var()` falls back to the
    default rather than reaching the DOM.
  - `normaliseSiteBannerTextSizePt` — rounds and clamps to 8–32pt.
  - `normaliseSiteBannerLinkUrl` — accepts `https://`, `http://` and
    site-relative `/…` only. This is what keeps `javascript:`, `data:` and
    `vbscript:` out of an `href`; protocol-relative `//host` is rejected too,
    since it inherits whatever scheme the page was served over.
  - `isSiteBannerVisible` — an enabled banner with blank text stays hidden, so
    an empty coloured strip can never appear on every page.
  - `parseSiteBannerConfig` — tolerant, field-by-field fallback, matching
    `parseSiemConfig` / `parseUsageLimitsConfig`.
- `packages/domain/src/entities/site-banner.test.ts` (new) — 25 cases covering
  the defaults, the clamp, hex rejection, every rejected URL scheme, and the
  visibility rule.

### Adapters — one more runtime setting

- `packages/adapters/src/config/runtime-config-store.ts` —
  `getSiteBannerConfig()` / `invalidateSiteBanner()` with the same
  cache-and-pending pair every other runtime setting uses. Stored under the new
  `site_banner_config` key in the existing `admin_system_settings` key/value
  table, so there is **no migration and no DDL**.

### Web API

- `apps/web/src/server/routers/settings.ts` — `getSiteBanner` is a
  **`publicProcedure`**: the login and register screens are exactly where a site
  warning matters most, and the config carries no secret material (it is not in
  `SENSITIVE_SETTING_KEYS`). `setSiteBanner` is an `adminProcedure` whose zod
  schema re-applies the same hex, range and URL rules, so an admin gets a
  validation error rather than the silent fallback the read path uses.

### Web UI

- `apps/web/src/components/site-banner.tsx` (new) — one centred line, truncated
  with an ellipsis rather than wrapped, `role="status"`. Renders `null` when
  disabled or blank. External links get `target="_blank"` +
  `rel="noopener noreferrer"`; relative links go through `next/link`.
- `apps/web/src/components/settings/site-banner-card.tsx` (new) — an on/off
  checkbox on the card face for a one-click switch, everything else behind an
  Edit modal, with a live preview rendered in both places.
- `apps/web/src/app/(admin)/admin/settings/page.tsx` — card added to the
  **Notifications** section.

### Layout — the part that wasn't obvious

The banner sits above three route groups that each assumed they owned the whole
viewport (`h-screen` in `(user)` and `(admin)`, `min-h-screen` in `(auth)`).
Prepended naively, an enabled banner would have made every page `100vh + banner`
and introduced a body-level scrollbar. Instead `<body>` became
`flex h-dvh flex-col`, with the banner as the first child and a
`flex min-h-0 flex-1 flex-col` wrapper around `{children}`; the three layouts
became flex children that resolve to the *remaining* height. Three further
`h-screen` users inside that tree were adjusted for the same reason:
`components/sidebar.tsx` (now stretches to its flex row), and the two
loading/not-found states in `(user)/chats/[sessionId]/_content.tsx` (now
`flex-1`). `h-dvh` rather than `h-screen` so mobile browser chrome does not clip
the layout.

`global-error.tsx` renders its own `<html>`/`<body>` and is deliberately left on
`min-h-screen`.

## Tests

- `packages/domain/src/entities/site-banner.test.ts` — the parser, normalisers
  and visibility rule (all the real logic).
- `packages/adapters/src/config/runtime-config-store.test.ts` — six new cases:
  defaults when nothing is stored, round-trip, `javascript:` URL dropped,
  unparseable colour/size fallback, cache hit, and re-read after invalidation.
- `apps/web/src/components/site-banner.test.tsx` — component export plus
  `buildSiteBannerStyle` (the web app has no jsdom environment, so meaningful
  assertions live in the pure helper and in the e2e).

### E2E covering this change

**`apps/web/e2e/enhance-site-banner.spec.ts`** — six tests: off by default; an
admin configures text, 16pt, white-on-red and a link, and the banner renders
with those exact computed styles on the admin screen *and* on `/chats`, without
pushing the page past the viewport; a signed-out visitor sees it on `/login`;
clearing the link keeps the text and drops the CTA; a `javascript:` URL is
rejected; switching it off removes it for both signed-in and signed-out
visitors. An `afterAll` guard always switches the banner back off, since it is
global state shared with every later spec.

The suite was **not** run in the authoring sandbox — it runs in CI against the
provisioned stack.

### Two follow-up fixes from the first CI run

**Hydration mismatch on `/admin/settings`.** Three unrelated specs
(`enhance-configurable-embeddings`, `enhance-reindex-documents`,
`phase-code-quality-hot-paths-group-d`) assert zero console errors on the
settings page and all three failed. `SiteBanner` runs its query at the root of
every page, so the result could land in the react-query cache while React was
still hydrating the settings subtree below; the card then rendered its loaded
state on a first client pass whose server HTML said "Loading…". `useHydrated`
defers the cache read to after mount, so the first client render always matches
the server. Applied to both `SiteBanner` and `SiteBannerCard`. This is a
consequence of putting a query at the root of the tree — no other settings card
had a reason to hit it.

**A shard-boundary knock-on.** Adding a spec file redistributed Playwright's
shards, and `phase-multi-organisation-support` lost the non-admin user it had
been getting incidentally from whichever registration spec previously shared its
shard — its Members card renders no per-user `<select>` without one. The spec
already documented the assumption ("the seeded fixtures provide one"); the seed
now actually provides it, via `resolveMemberUserId` in `e2e-fixtures.ts`.

## Validation

`./validate.sh` — 19 passed, 0 failed. One pre-existing WARN
(`runtime-config-store.ts` is now 781 lines, over the 700-line advisory
threshold it already exceeded at 753; splitting it is left for the next change
that touches it).

## Known interaction

The knowledge-base drawer (`(user)/knowledge/_content.tsx`) is a
`fixed top-0 h-screen` overlay panel, so while it is open it covers the banner.
That is inherent to a viewport-anchored overlay and was left alone rather than
threading a banner-height custom property through it.
