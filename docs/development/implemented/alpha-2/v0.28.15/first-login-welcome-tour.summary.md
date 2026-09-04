# Implementation Summary — First-Login Welcome Tour (v0.28.15)

- **Version**: 0.28.15 — **PATCH** (the maintainer chose PATCH, and the alpha-2 release line, over the MINOR on `main` the branching rules would normally take for a new feature)
- **Base branch**: `release/alpha-2` (alpha-2 line)
- **Phase doc**: [`first-login-welcome-tour.phase.md`](./first-login-welcome-tour.phase.md)
- **PRD**: `docs/development/prd/first-login-welcome-tour.prd.md`
- **ADR**: `docs/development/adr/056-welcome-tour-state-and-journey-handoff.adr.md`

## What was built

A first sign-in now opens a welcome modal split into **Start a chat** (every
published flow as a one-click chat type) and **Build a flow**. The flow path
opens the New Flow dialog on `/flows` with a "Step 1 of 2" callout tethered to
it by a drawn connector, and creating the flow lands on the configure canvas
with a six-card animated explainer over a blurred background. The last card's
call to action closes the explainer and pulses a "Start here" pointer over
"+ Create your first step". The explainer replays from the flow menu ("How
flows work") and from a subtle "Watch how flows work" link on an empty canvas;
the whole tour restarts from a new card on Settings.

The tour shows once per user: a `welcome_tour_completed_at` stamp on
`core_users` is written the moment a path is chosen or the modal is skipped.
Accounts that exist when the migration runs are backfilled as toured.

## Files created

| File | Purpose |
|---|---|
| `packages/application/src/use-cases/set-welcome-tour-completed.ts` (+ test) | The one writer of the stamp: complete (now) or restart (null). |
| `packages/adapters/drizzle/0045_welcome_tour.sql` | Column + backfill, `-- data-impact: preserved`. |
| `apps/web/src/components/tour/tour-stage.ts` (+ test) | `tour` URL stage parsing, next-URL builder, the gate rule. |
| `apps/web/src/components/tour/flow-explainer-cards.ts` (+ test) | The six cards' copy and carousel navigation. |
| `apps/web/src/components/tour/tour-beat-model.ts` (+ test), `use-tour-beat.ts` | Beat sequencing for the illustrations; reduced motion pins to the final beat. |
| `apps/web/src/components/tour/welcome-tour-gate.tsx`, `welcome-tour-dialog.tsx` | The gate in the `(user)` layout and the split modal. |
| `apps/web/src/components/tour/new-flow-step-callout.tsx` | The Step 1 explainer beside the New Flow dialog. |
| `apps/web/src/components/tour/flow-explainer-carousel.tsx` | Arrows, dots, keyboard navigation, hand-off CTA. |
| `apps/web/src/components/tour/explainer-animations/*.tsx` | Shared stage helpers and one illustration per card. |
| `apps/web/src/components/settings/welcome-tour-card.tsx` | "Restart the welcome tour". |
| `apps/web/e2e/welcome-tour.spec.ts` | Group 4 coverage of the two page-load hand-offs. |

## Files modified

- **domain** — `entities/user.ts` (`welcomeTourCompletedAt` on `User` and `UserUpdate`).
- **application** — `use-cases/index.ts`; the organisation test fixtures gained the new field.
- **adapters** — `db/schema/core.ts`, `repositories/drizzle-user-repository.ts`, `auth/__tests__/admin-recovery.test.ts`.
- **apps/web** — `server/routers/user.ts` (`welcomeTourPending`, `completeWelcomeTour`, `restartWelcomeTour`), `lib/container.ts`, `app/api/auth/test-session/route.ts` (stamps test users as toured unless `tour: "pending"`), `app/(user)/layout.tsx`, `app/(user)/flows/_content.tsx`, `app/(user)/flows/[id]/config/_content.tsx`, `app/(user)/flows/[id]/config/_flow-config-header.tsx`, `components/flow/flow-metadata-dialog.tsx` (`guide` slot), `components/canvas/flow-canvas-viewport.tsx`, `app/(user)/settings/page.tsx`, `styles/globals.css`.
- **root** — `VERSION`, `package.json`.

## Migrations

`0045_welcome_tour.sql`, generated with `drizzle-kit generate` and then given
its backfill:

```sql
ALTER TABLE "core_users" ADD COLUMN "welcome_tour_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "core_users" SET "welcome_tour_completed_at" = now();
```

Declared `-- data-impact: preserved`. `db:drift` confirms the schema matches
its snapshot. Not run against a database in this session — no infrastructure
was available.

## Tests

- Unit: 4 (use case) + 19 (tour models). Full suite: 3,935 tests across the
  workspace, all passing.
- e2e: `welcome-tour.spec.ts` — policy group 4 (navigation state across a page
  load). Written, not run; CI runs it.
- Visual: the modal, callout, carousel and all six illustrations were rendered
  in a throwaway esbuild + Tailwind harness and screenshotted in headless
  Chromium at the final frame and mid-loop.

## Deviations from the approved change summary

1. **PATCH instead of MINOR** — at the maintainer's request.
2. **`welcome_tour_completed_at` is a dedicated column** — `core_users` has no
   JSONB column to reuse, as confirmed before building.
3. **`_node-config-values.ts` was extracted** — the configure page was already
   798 lines, and the tour wiring pushed it past `validate.sh`'s 800-line
   ceiling. The node-config-values derivation moved out unchanged.

## Known limitations

- The illustrations use fixed pixel layouts inside a 520×220 stage; below
  roughly 600px viewport width the carousel scales its width and the stage is
  clipped rather than reflowed.
- Abandoning the New Flow dialog mid-tour ends the tour; the person restarts
  it from Settings rather than being re-prompted.
