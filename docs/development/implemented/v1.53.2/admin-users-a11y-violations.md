# Fix — Admin Users A11y Violations (v1.53.2)

**Version bump:** PATCH (`1.53.1` → `1.53.2`) — style/markup only, no schema or API change.

## Root cause

`tests/e2e/accessibility.spec.ts` flagged two WCAG 2.2 AA violations on
`/admin/users`:

- `color-contrast` (serious) — the `destructive` button variant used
  `--destructive: 0 84% 60%` (#ef4343), giving only 3.78:1 contrast with white
  text against a 4.5:1 requirement.
- `label` (critical) — the "Power User" toggle `<input type="checkbox">` had
  no accessible name.

## Fix

- `apps/web/src/styles/globals.css` — darkened `--destructive` to
  `0 72% 51%` (#dc2626, 4.83:1 with white text).
- `apps/web/src/app/(admin)/admin/users/_content.tsx` — added
  `aria-label={`Power user: ${u.name ?? u.email}`}` to the toggle checkbox.

## Verification

Left to GitHub CI (`tests/e2e/accessibility.spec.ts`) rather than run locally.
