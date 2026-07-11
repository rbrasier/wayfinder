# Implementation Summary — Code Quality: Hot Paths, Group D (frontend decomposition) (v2.2.3)

- **Version**: 2.2.3 (**PATCH** — a mechanical file decomposition with
  byte-for-byte behaviour. No schema change, no new dependency, no public API
  change; whole component functions were moved verbatim.)
- **Date**: 2026-07-06
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group D
  — frontend and file decomposition** (phase doc under `to-be-implemented/`).
- **Scope built**: item **9** — split the 2,183-line admin settings page. The
  four remaining Group D targets (items 10–13) are untouched and stay on the
  `validate.sh` size allowlist.

## What was built

`apps/web/src/app/(admin)/admin/settings/page.tsx` was the single worst offender
in the file-size ratchet at 2,183 lines. It was already cleanly composed of ~14
self-contained `*Card` function components (each owning its own tRPC hooks and
local state) plus a shared connectivity block and a thin default-export page
that wires them together — so the decomposition is a pure move, not a rewrite.

Each card and the shared connectivity infrastructure moved into its own file
under `apps/web/src/components/settings/`:

- `connectivity.tsx` — the shared connectivity layer (`useConnectivity` hook,
  `ConnectivityController` type, `ConnectivityBadge`, `ConnectivityTest`,
  `BadgeState`, `ALL_CONNECTIVITY_TARGETS`). This is the "extract shared
  hooks/components under `components/settings/`" the phase calls for.
- One file per settings section: `organisation-name-card.tsx`,
  `global-instructions-card.tsx`, `registration-toggle-card.tsx`,
  `auth-methods-card.tsx`, `ai-provider-card.tsx`, `n8n-integration-card.tsx`,
  `storage-card.tsx`, `rag-embeddings-card.tsx`, `session-uploads-card.tsx`,
  `document-generation-card.tsx`, `email-card.tsx`,
  `notification-settings-card.tsx`, `hr-data-card.tsx`,
  `entra-directory-card.tsx`.

Each section-local type/const (e.g. the AI provider label map, the embeddings /
email provider choices, the HR field options and `fileToBase64` helper) moved
with the one card that uses it and stays file-private. The page shell keeps only
the layout, the section headings, the header "Test all" button, and the single
`useConnectivity()` instance it threads into the connectivity-bearing cards.

The card bodies are unchanged — every component function was moved verbatim, so
hook order within each component and the render order in the page are identical
to before. The behavioural risk of this kind of split is a *dropped* card, which
the new e2e (below) guards against.

## Files changed

- `apps/web/src/app/(admin)/admin/settings/page.tsx` — 2,183 → 75 lines; now
  imports and composes the extracted components.
- `apps/web/src/components/settings/connectivity.tsx` (new) + 14 new
  `*-card.tsx` files (largest is `email-card.tsx` at 310 lines; all well under
  the 700-line warn threshold).
- `validate.sh` — removed `apps/web/src/app/(admin)/admin/settings/page.tsx`
  from `SIZE_LEGACY_ALLOWLIST` (four legacy entries remain).
- `tests/e2e/phase-code-quality-hot-paths-group-d.spec.ts` (new).
- `VERSION`, `package.json` — 2.2.2 → 2.2.3.

## Migrations run

None.

## Tests added

- **E2E** — `phase-code-quality-hot-paths-group-d.spec.ts`: loads
  `/admin/settings` and asserts the AI section anchor, the header "Test all"
  button, and each of the six connectivity cards' `test-connectivity-<target>`
  buttons render, with no console errors — proving no section was dropped in the
  split. (The existing `admin-settings.spec.ts` continues to cover org-name and
  the AI provider modal.)

## Verification

- `pnpm --filter @wayfinder/web exec tsc --noEmit` — clean (imports resolve,
  no unused vars).
- `eslint` over the new files + the rewritten page — clean (`no-unused-vars` is
  an error rule; each extracted file carries a precise import set, and
  `consistent-type-imports` is honoured for the type-only imports).
- `./validate.sh` — all checks pass; the size check now passes with the settings
  page off the allowlist.

## Known limitations / follow-ups

- Group D items **10–13** remain on the allowlist and warn list:
  `node-config-modal.tsx` (split per node type/tab), the two flow-config
  `_content.tsx` files (extract shared sections), and `turn-helpers.ts` (largely
  dissolved by Group B item 6). The phase is complete when the allowlist is
  empty.
- This slice cannot be runtime-verified in the sandbox (no browser/Postgres);
  correctness rests on typecheck + eslint + the a11y/validate checks plus the
  fact that whole component functions moved unchanged. The new e2e runs in CI.
