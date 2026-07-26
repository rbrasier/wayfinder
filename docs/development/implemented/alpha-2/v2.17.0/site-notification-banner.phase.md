# Phase — Site-wide notification banner

- **Status**: Implemented in 2.17.0 (enhancement)
- **Target version**: 2.17.0 — **MINOR** (new admin-configurable capability; no
  schema change — the config is one JSON row in `admin_system_settings`).
- **Base branch**: `main` (the 2.x line). A banner is net-new capability, so it
  does not belong on `release/alpha-1`, which is stabilisation-only.
- **Working branch**: `claude/notification-banner-olkdd4`.
- **Depends on**: the existing `RuntimeConfigStore` / `admin_system_settings`
  pattern (`session_upload_config`, `extraction_config`).

## 1. Goal

Give administrators a single banner strip across the very top of every page,
for notifications and site warnings ("maintenance tonight 8pm", "degraded AI
provider"). It must be switchable on and off, and its text, text size, text
colour and background colour must all be admin-configurable without a redeploy.

Defaults: **off**, empty text, **12pt**, **red text** (`#dc2626`) on a **white
background** (`#ffffff`), sized for a **single line**, **centred**.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Dismissible by end users? | **No.** Visible while enabled; only an admin turns it off. A site warning nobody can hide is the point. |
| Size / colour controls | Numeric size in **pt** (clamped 8–32), plus native colour pickers with hex text inputs. |
| Scope | **Every** page — signed-out (`/login`, `/register`), the user app, and the admin console. |
| Where the config lives | One JSON row in `admin_system_settings` under key `site_banner_config`, read through `RuntimeConfigStore`. |
| Call to action | **Optional link.** A blank URL means text only; a set URL renders a trailing inline link on the same line. |

## 3. What is built

| # | Layer | File(s) | Change |
|---|-------|---------|--------|
| 1 | Domain | `packages/domain/src/entities/runtime-config.ts` | `SiteBannerConfig` interface + `createDefaultSiteBannerConfig()`. Pure TS, no deps. |
| 2 | Adapters | `packages/adapters/src/config/runtime-config-store.ts` | `SITE_BANNER_CONFIG_SETTING_KEY`, `parseSiteBannerConfig`, `getSiteBannerConfig()`, `invalidateSiteBanner()`. |
| 3 | Web API | `apps/web/src/server/routers/settings.ts` | `getSiteBanner` (**publicProcedure**), `setSiteBanner` (`adminProcedure`, zod-validated, invalidates the cache). |
| 4 | Web UI | `apps/web/src/components/site-banner.tsx` (new) | Client component; renders nothing when disabled or when the text is blank. |
| 5 | Web UI | `apps/web/src/app/layout.tsx` | Mount `<SiteBanner />` inside `TrpcProvider`; make `<body>` a flex column so the banner subtracts from the viewport instead of adding to it. |
| 6 | Web UI | `(user)/layout.tsx`, `(admin)/admin/layout.tsx`, `(auth)/layout.tsx` | `h-screen` / `min-h-screen` → flex children of the new body column. |
| 7 | Web UI | `apps/web/src/components/settings/site-banner-card.tsx` (new) | Admin card: enable toggle, text, size, two colours, optional link URL + label, live preview. |
| 8 | Web UI | `(admin)/admin/settings/page.tsx` | Add the card to the **Notifications** section. |

### `SiteBannerConfig`

```ts
export interface SiteBannerConfig {
  enabled: boolean;
  text: string;
  textSizePt: number;
  textColour: string;       // #rrggbb
  backgroundColour: string; // #rrggbb
  linkUrl: string;          // "" = text only
  linkLabel: string;        // "" = falls back to DEFAULT_SITE_BANNER_LINK_LABEL
}
```

### The optional call to action

`linkUrl` is empty by default, and an empty URL means the banner is text only.
When set, the banner renders a trailing `<a>` on the same line, inheriting the
configured text colour with an underline so it reads as a link against any
background the admin picks. `linkLabel` names it; blank falls back to
`"Learn more"`.

Only three URL shapes are accepted, enforced identically in the config-store
parser and the tRPC input schema: `https://…`, `http://…`, and site-relative
paths beginning with `/`. Anything else — most importantly `javascript:` and
`data:` — is rejected on write and falls back to empty on read, so a stored
value can never become a script-executing `href`. External links (`http(s)://`)
get `target="_blank"` with `rel="noopener noreferrer"`; relative links navigate
in place.

### Why a public read procedure

`/login` and `/register` are the pages most likely to need a warning ("SSO is
down"), and they are rendered for unauthenticated visitors. The read endpoint is
therefore a `publicProcedure`, mirroring the existing `registrationEnabled` and
`enabledAuthMethods`. The write endpoint stays `adminProcedure`. The banner
config carries no secret material, so the public read leaks nothing.

### Single line, centred

The banner renders one flex row with `justify-center`. Text that would wrap is
truncated with an ellipsis (`overflow: hidden; text-overflow: ellipsis;
white-space: nowrap`) so an over-long message can never silently grow the strip
to two lines and shift every page's layout.

### Layout adjustment (the non-obvious part)

`(user)/layout.tsx` and `(admin)/admin/layout.tsx` currently use `h-screen`, and
`(auth)/layout.tsx` uses `min-h-screen`. If the banner were simply prepended in
normal flow, the page would become `100vh + banner`, introducing a body-level
scrollbar on every screen the moment the banner is switched on. Instead:

- `<body>` becomes `flex h-dvh flex-col` with the banner as the first child and
  a `flex min-h-0 flex-1 flex-col` wrapper around `{children}`.
- The three layouts become flex children (`min-h-0 flex-1`) rather than
  viewport-height boxes, so they resolve to *remaining* height.

`apps/web/src/app/page-ssr-structure.test.ts` is checked against this change.

### Validation, and why it lives in the adapter

Colours are validated as `#rrggbb`, the size is clamped to 8–32pt, and the link
URL is restricted to the three shapes above — all at the config-store boundary,
with any invalid field falling back to its default. This matches how
`parseSessionUploadConfig` and `parseStorageConfig` already behave. Colours
reach the DOM as inline `style` properties and the URL as an `href`, so a stored
value that never passes its check cannot inject arbitrary CSS or a `javascript:`
navigation. The tRPC input schema applies the same rules, so an admin gets an
error rather than a silent fallback.

## 4. Database changes

**None.** `admin_system_settings` is an existing key/value table; this adds one
row under a new key. No migration, no DDL, no `drizzle-kit` change.

## 5. Implementation order (tests first)

1. Domain entity + default factory (no test — a plain data shape and constant).
2. `runtime-config-store.test.ts` cases for the parser (defaults, clamping,
   bad hex rejection, `javascript:` URL rejection, malformed JSON), then the
   store methods.
3. `settings.ts` router endpoints.
4. `site-banner.test.tsx` (hidden when off, hidden when text blank, applies the
   configured styles, renders the link only when a URL is set, and opens
   external links safely), then `site-banner.tsx`.
5. Root layout mount + the three layout conversions.
6. Admin card + settings page wiring.
7. Playwright e2e `apps/web/e2e/enhance-site-banner.spec.ts`.

`./validate.sh` after each step.

## 6. E2E coverage

`apps/web/e2e/enhance-site-banner.spec.ts`:

1. Admin opens Configuration → Notifications, enables the banner, sets text,
   size, both colours and a link URL + label, saves.
2. The banner is visible on an admin page with the configured text and computed
   styles, and the link renders with the configured label and `href`.
3. The banner is visible on `/login` in a signed-out context.
4. Admin clears the link URL; the banner keeps its text and drops the link.
5. Admin disables it; the banner is gone from both pages.

## 7. Risks / open questions

- **Cache staleness across processes.** `RuntimeConfigStore` caches in-process,
  so in a multi-instance deployment a banner change propagates as each instance's
  cache is invalidated or replaced. This is the same trade-off every other
  runtime setting already makes; not worth a new invalidation channel here.
- **Contrast.** An admin can pick white-on-white. The live preview in the admin
  card is the mitigation — enforcing a contrast ratio would fight the explicit
  requirement for free colour choice.
- **`h-dvh` on body.** Chosen over `h-screen` so mobile browser chrome does not
  clip the layout. Behaviour on the three route groups is verified by the e2e
  run, not just unit tests.
