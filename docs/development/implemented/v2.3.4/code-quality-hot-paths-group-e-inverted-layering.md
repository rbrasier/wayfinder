# Implementation Summary — Code Quality: Hot Paths, E16 (inverted layering) (v2.3.4)

- **Version**: 2.3.4 (**PATCH** — pure file move; behaviour identical).
- **Date**: 2026-07-10
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
  **Group E item 16** — fix inverted layering: the tRPC session router was
  importing `confirmStep` from the `app/api/.../stream/` route directory.
- **Scope built**: move `confirmStep` (and its private helper
  `recomputeBranchChoice`) out of the HTTP-route directory to a shared server
  lib. The phase doc listed this as "moves to the application layer or a
  shared server lib"; the shared server lib is chosen here because the full
  application-layer move is entangled with the still-open `ExecuteTurn`
  extraction (item 6).

## What was built

- New: `apps/web/src/lib/chat/confirm-step.ts` — contains `confirmStep`,
  `recomputeBranchChoice`, and the `ConfirmStepInput` / `ConfirmStepResult`
  types. Imports `applyAdvanceSideEffects` and `buildGatheredContext` from
  the stream turn-helpers module.
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` — `confirmStep`
  and `recomputeBranchChoice` deleted (plus the newly-unused imports:
  `FlowEdge`, `Result`, `ok`, `branchChoiceSchema`).
- `apps/web/src/server/routers/session.ts` — the `confirmStep` import now
  points at `@/lib/chat/confirm-step` instead of the stream route directory.

The scheduler `scheduled-session-fire-handler.ts` was not affected — it
imports helper utilities from turn-helpers but never `confirmStep`.

## Files changed

- `apps/web/src/lib/chat/confirm-step.ts` (new, 150 lines)
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (deletion)
- `apps/web/src/server/routers/session.ts` (import path only)
- `VERSION`, root `package.json` — 2.3.3 → 2.3.4

## Migrations run

None.

## Tests

- Full unit suite green (34 web files / 206 tests + domain + adapters + app + api).
- `./validate.sh` green (19/19).

E14 (narrow `container.repos.*` reach in the stream route) and item 6 (full
`ExecuteTurn` application-layer extraction) remain — both benefit from the
`generateTitle` port migration and the streaming writer port abstraction, and
are best landed as a single application-layer refactor rather than piecemeal.
