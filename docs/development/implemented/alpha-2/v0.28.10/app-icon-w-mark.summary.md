# Implementation Summary — A browser icon built from the header W mark

- **Version**: 0.28.10 (bump: **PATCH** — two static assets and one test; no
  product code, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **Phase doc**: [`app-icon-w-mark.phase.md`](./app-icon-w-mark.phase.md)

## What was built

`apps/web` now ships a browser icon. It is the header brand mark — the
`#2f56d3` rounded square with a white **W** that `sidebar.tsx` renders next to
the word *Wayfinder* — reproduced as a static SVG, plus a square PNG for iOS
home screens. Before this, the app declared no icon of any kind and every
browser fell back to its own placeholder.

### The files

| File | What it is |
|---|---|
| `apps/web/src/app/icon.svg` | 32-unit canvas, `rx="8.6"` (the header's 7/26 corner ratio), `fill="#2f56d3"`, white `W` as a single `<path>` |
| `apps/web/src/app/apple-icon.png` | 180 × 180, full-bleed square, no corner radius — iOS applies its own mask |
| `apps/web/src/app/app-icons.test.ts` | Three assertions, written before the assets |

Next's file-based metadata convention picks both up from `src/app/` with no
change to `layout.tsx`, emitting `<link rel="icon" type="image/svg+xml">` and
`<link rel="apple-touch-icon">`. No `metadata.icons` entry was added — one would
override the convention and duplicate the paths. The convention was verified
against `next/dist/lib/metadata/is-metadata-route.js` in `node_modules` rather
than from memory: `icon` accepts `svg`, `apple-icon` accepts `png`.

### The letterform

The `W` is the real Figtree Bold outline, extracted from the Google Fonts
woff2 (`upm` 1000, cap height 700, ink box `8 0 977 700`) and transformed onto
the 32-unit canvas as a path. An `<svg><text>` element would have resolved
against whatever font the browser had to hand when painting the tab strip —
`next/font/google` does not reach there — so the icon would have quietly stopped
matching the header. As a path it needs no font and no network request.

Every dimension is derived from the header lockup, with one deliberate
departure: the letter is set at **0.55 em rather than the header's 0.50**
(`text-[13px]` on a 26px square). At the header ratio the ink shrinks to 7.7px
inside a 16px favicon and reads as a smudge; 0.55 em holds the letterform.

## Tests

`apps/web/src/app/app-icons.test.ts` — file-reading assertions in the style of
`page-ssr-structure.test.ts`, its neighbour in the same directory:

1. `icon.svg` carries a `0 0 32 32` viewBox, fills with `TOKENS.primary` and
   paints the glyph white.
2. `apple-icon.png` parses as a PNG (signature + `IHDR`) measuring 180 × 180.
3. `sidebar.tsx` still uses `bg-[#2f56d3]`, so a change to the header brand
   colour cannot silently leave the icon behind.

**No e2e** — the change matches none of the six groups in
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md); it is a static
asset with no interaction, navigation state or streaming. `smoke.spec.ts`
already excludes favicon requests from its failed-request assertion.

`./validate.sh` passes.

## Known limitations

- **No dark-mode variant.** The icon is one blue square in both themes.
- **No `favicon.ico`.** Browsers that cannot read an SVG icon and do not read
  the apple-touch icon get no mark. That is IE and pre-2020 Safari.
- **The PNG is a generated artifact.** It was rasterised from the same geometry
  at 4× and downsampled; regenerating it means redoing that, as no build step
  produces it.

## Deviations from the approved change summary

The `/enhance` steps 1–2 (phase doc in `to-be-implemented/`, then
`/doc-review`) were skipped with the user's approval at the gate, on the
grounds that the change has no domain, application, adapter or database
surface. The phase doc was written at the end, directly into `implemented/`.
Everything else was built as summarised.
