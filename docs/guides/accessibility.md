# Accessibility (WCAG 2.2 AA)

Wayfinder's web UI (`apps/web`) targets **WCAG 2.2 Level AA**. This guide
describes how that standard is enforced and what each contributor is responsible
for.

## What is enforced automatically

`apps/web` lints every `.tsx` file with [`eslint-plugin-jsx-a11y`][jsx-a11y] at
its **strict** ruleset. Two config files drive this:

- `apps/web/.eslintrc.cjs` — the general lint config. Layers `jsx-a11y/strict`
  on top of the TypeScript rules, so `pnpm lint` fails on any accessibility
  violation.
- `apps/web/.eslintrc.a11y.cjs` — an accessibility-only config (no TypeScript or
  stylistic rules). Run on its own via `pnpm --filter @wayfinder/web lint:a11y`.

`validate.sh` runs the accessibility-only config as **check 15 (web
accessibility)**, so a11y regressions block CI independently of the general
lint pass. Keep the `jsx-a11y` rule list in the two config files in sync.

The lint layer covers the machine-checkable subset of WCAG 2.2 AA, mapped to the
relevant success criteria:

| Concern | Rule(s) | WCAG SC |
|---|---|---|
| Image alt text | `alt-text`, `img-redundant-alt` | 1.1.1 |
| Form labels | `label-has-associated-control` | 1.3.1, 3.3.2 |
| Group labels | `role="group"`/`aria-labelledby` (manual) | 1.3.1 |
| Headings have content | `heading-has-content` | 1.3.1 |
| Page language | `html-has-lang` | 3.1.1 |
| Keyboard operability | `click-events-have-key-events`, `interactive-supports-focus`, `no-static-element-interactions`, `mouse-events-have-key-events` | 2.1.1 |
| Predictable focus | `no-autofocus`, `tabindex-no-positive`, `no-noninteractive-tabindex` | 2.4.3 |
| Link purpose | `anchor-has-content`, `anchor-is-valid` | 2.4.4 |
| Name, Role, Value | `aria-*`, `role-*` | 4.1.2 |

### Patterns this codebase uses

- **Group labels** — a caption for a set of controls (a radio set, a colour
  swatch row) is not a `<label>`. Use `FieldGroupLabel`
  (`components/ui/field-group-label.tsx`) and associate it with the group via
  `role="group"`/`role="radiogroup"` + `aria-labelledby`.
- **Auto-focus** — the `autoFocus` prop is forbidden (it can move focus
  unexpectedly on load). To focus an element that appears in response to a user
  action, use `useFocusOnMount` (`lib/use-focus-on-mount.ts`), a ref + effect
  gated on the reveal state, or a dialog's `onOpenAutoFocus` handler.
- **Overlays/backdrops** — a click-to-dismiss backdrop is a `<button>`, not a
  `<div onClick>`, so it is keyboard-focusable and activatable.
- **Colour contrast (1.4.3)** — body and UI text meets ≥4.5:1 against its
  surface. Muted/secondary text is the usual offender: the `--muted-foreground`
  / `--text3` tokens (`src/styles/globals.css`) and the hard-coded
  `text-[#…]` greys were darkened to clear 4.5:1 on white and the light card
  surfaces (`#f7f6f3` / `#efede8`). Decorative glyphs (e.g. a `|` separator)
  are marked `aria-hidden` instead. When adding muted text, reuse
  `text-muted-foreground` / `#6d6a65` rather than a lighter grey.

## Runtime checks (Playwright + axe-core)

The criteria below only exist once the page is rendered, so they are verified at
runtime by `tests/e2e/accessibility.spec.ts` rather than by the linter. The spec
runs in the E2E workflow (`.github/workflows/e2e.yml`) against the seeded admin
session, and can be run on its own:

```bash
cd tests/e2e
npm run test:a11y      # needs the app running on http://localhost:3000
```

It uses [axe-core][axe] (the engine behind most automated audits, which computes
the rendered accessibility tree and real colour values) plus a couple of custom
probes:

| Concern | How | WCAG SC |
|---|---|---|
| Text / non-text contrast | axe `color-contrast` (`wcag2aa`) | 1.4.3, 1.4.11 |
| Computed name/role/value | axe (`wcag2a`/`aa`) | 4.1.2 |
| Target size | axe `target-size` (`wcag22aa`) | 2.5.8 |
| Focus visible | custom probe — Tab and assert an outline/ring/box-shadow | 2.4.7 |
| Reflow | custom probe — no horizontal scroll at 320px width | 1.4.10 |

The third-party React Flow canvas is excluded from the editor scan (we don't own
its SVG controls).

## What still needs a manual audit

The remaining criteria are not reliably automatable. Check these by hand
(keyboard-only navigation, a screen reader, 200% zoom) when changing UI:

- **2.4.11 / 2.4.13 Focus Appearance (2.2)** — the focus indicator is not just
  present (covered above) but large and contrasting enough.
- **2.4.3 Focus Order** — focus moves in a logical order; modals trap focus
  (Radix handles this) and restore it on close.
- **1.4.4 Resize Text** — usable at 200% zoom (the spec checks 320px reflow but
  not text-only zoom).
- **3.3.7 Redundant Entry** & **3.3.8 Accessible Authentication (2.2)** — don't
  force re-entry of information; don't rely on cognitive function tests for auth.
- **2.5.7 Dragging Movements (2.2)** — drag operations (e.g. the flow canvas)
  have a single-pointer alternative.

Colour tokens live in `src/styles/globals.css`.

[jsx-a11y]: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
[axe]: https://github.com/dequelabs/axe-core
