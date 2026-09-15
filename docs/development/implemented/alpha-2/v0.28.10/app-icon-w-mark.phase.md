# Enhancement — A browser icon built from the header W mark

- **Status**: Implemented in 0.28.10 (`/doc-review`: not run — see *Process
  deviation* below)
- **Target version**: **PATCH** — 0.28.9 → 0.28.10 (two static assets and one
  test; no product code, no schema impact)
- **Base branch**: `release/alpha-2` (reaches `main` via `/release` →
  Forward-merge)
- **Type**: `/enhance`
- **PRD / ADR**: none — visual chrome, not a product capability

## 1. Goal

A Wayfinder tab should be identifiable at a glance in a strip of twenty other
tabs, and a bookmark or iOS home-screen shortcut should carry the same mark the
user sees in the app header.

Today it carries nothing.

## 2. The problem

`apps/web` ships no icon at all. There is no `public/` directory, no
`favicon.ico`, and no `icons` entry on the `Metadata` export in
`src/app/layout.tsx` — the file sets only `title` and `description`. Every
browser therefore falls back to its own placeholder: a blank sheet in Chrome, a
globe in Firefox, the first letter of the title in some mobile browsers.

The mark to use already exists and needs no design work. `sidebar.tsx` renders
it in the brand lockup:

```tsx
<div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#2f56d3] text-[13px] font-bold text-white">
  W
</div>
```

A 26px square, `rounded-[7px]`, filled with `TOKENS.primary` (`#2f56d3`), with a
white 13px Figtree Bold `W` centred on it.

## 3. Approach

Reproduce that lockup as a static SVG rather than reference the DOM mark, and
derive every number in it from the header's own proportions:

| Header | Icon (32-unit canvas) |
|---|---|
| `h-[26px] w-[26px]` | `viewBox="0 0 32 32"` |
| `rounded-[7px]` → 7/26 = 0.269 | `rx="8.6"` → 8.6/32 = 0.269 |
| `bg-[#2f56d3]` | `fill="#2f56d3"` (`TOKENS.primary`) |
| `text-white` | `fill="#ffffff"` |
| `text-[13px]` on 26px → 0.50 em | 0.55 em — see below |

**The letterform is a path, not text.** An `<svg><text>` element would resolve
against whatever font the browser has to hand when it paints the tab strip;
`next/font/google` is not in scope there, so the icon would render in a system
sans and stop matching the header. The `W` is instead the real Figtree Bold
outline (`upm` 1000, advance 985, cap height 700, ink box `8 0 977 700`),
transformed onto the 32-unit canvas and inlined as a single `<path>`. The icon
carries no font dependency and no network request.

**The letter is set at 0.55 em, not the header's 0.50.** At the header's ratio
the ink is 12.6px wide inside a 26px square; scaled to a 16px favicon that
leaves a 7.7px letter with heavy surrounding padding, which reads as a blue
square with a smudge in it. 0.55 em gives 17.05 × 12.32 units on the 32-unit
canvas and holds its shape at 16px. This is the one deliberate departure from
the header lockup.

**iOS gets a full-bleed square.** `apple-icon.png` is 180 × 180 with no corner
radius and no transparency, because iOS applies its own mask and superellipse
to home-screen icons; a self-rounded icon shows the mask's corners cut twice.

## 4. Delivery

Next's file-based metadata convention picks both files up from `src/app/` with
no change to `layout.tsx` — verified against
`next/dist/lib/metadata/is-metadata-route.js` in `node_modules`, where
`STATIC_METADATA_IMAGES.icon.extensions` includes `svg` and
`STATIC_METADATA_IMAGES.apple.filename` is `apple-icon` with `png` among its
extensions. Next emits:

- `<link rel="icon" href="/icon.svg?<hash>" type="image/svg+xml" sizes="32x32">`
- `<link rel="apple-touch-icon" href="/apple-icon.png?<hash>" type="image/png" sizes="180x180">`

No `metadata.icons` entry is added. Declaring one would override the file
convention and put the same two paths in two places.

## 5. Tests

`apps/web/src/app/app-icons.test.ts`, in the file-reading style already
established by `page-ssr-structure.test.ts` in the same directory:

1. `icon.svg` carries a `0 0 32 32` viewBox, fills with `TOKENS.primary`, and
   paints the glyph white.
2. `apple-icon.png` parses as a PNG (signature + `IHDR`) measuring 180 × 180.
3. `sidebar.tsx` still uses `bg-[#2f56d3]` — the icon and the header brand mark
   are hand-written in two places, and this is what stops one from drifting
   away from the other unnoticed.

**No e2e.** The behaviour matches none of the six groups in
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md) — it is a static
asset with no interaction, no navigation state and no streaming.
`smoke.spec.ts` already excludes favicon requests from its failed-request
assertion, so nothing there changes either.

## 6. Out of scope

- A dark-mode icon variant (`prefers-color-scheme` inside the SVG). The blue
  square carries its own contrast on any tab-strip background.
- `manifest.webmanifest` and PWA install icons — Wayfinder is not installable.
- `opengraph-image` / `twitter-image` for link previews.
- `favicon.ico`. Every browser Wayfinder supports reads the SVG.

## 7. Process deviation

Steps 1–2 of `/enhance` (a phase doc in `to-be-implemented/` reviewed by
`/doc-review` before any code is written) were skipped with the user's approval,
recorded in the approval gate. The change is two static assets with no domain,
application, adapter or database surface, and no business rule attached. This
doc was written at the end, into `implemented/`, rather than at the start.
