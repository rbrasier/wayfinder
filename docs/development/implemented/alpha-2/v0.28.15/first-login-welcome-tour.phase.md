# Phase — First-Login Welcome Tour

- **Status**: Implemented (v0.28.15)
- **Target version**: **PATCH** — 0.28.14 → **0.28.15** on the alpha-2 line (maintainer's call: PATCH, and this release line, rather than the MINOR on `main` the branching rules would usually take for a new feature)
- **PRD**: `docs/development/prd/first-login-welcome-tour.prd.md`
- **ADR**: `docs/development/adr/056-welcome-tour-state-and-journey-handoff.adr.md`
- **Depends on**: ADR-038 §4 (organisation sign-in gate), ADR-008 (canvas)
- **Base branch**: `release/alpha-2` (maintainer's call — see Target version)

## 1. Goal

A person signing in for the first time is shown what Wayfinder does and is
walked, end to end, through either starting a guided chat or building their
first flow — with the flow editor explained in six short animated cards that
use a leave request and a procurement approval rather than abstract diagrams.

## 2. Approach

Completion is a timestamp on the user (ADR-056 §1). The welcome modal is a
gate in the `(user)` layout, beside the organisation sign-in gate, and yields
to it (§4). The journey crosses two page loads by carrying a `tour` stage in
the URL (§2): `/flows?tour=new-flow` opens the New Flow dialog with a Step 1
callout; creating the flow continues to `/flows/<id>/config?tour=flow-explainer`,
which opens the carousel. The carousel is also reachable from the flow menu
and from a subtle link on the empty canvas, and the whole tour restarts from
Settings. Illustrations are beat-sequenced (§3) so reduced motion holds the
final frame.

## 3. What is built

### `packages/domain`

| File | Change |
|---|---|
| `entities/user.ts` | `User.welcomeTourCompletedAt: Date \| null`; `UserUpdate.welcomeTourCompletedAt?: Date \| null`. |

### `packages/application`

| File | Change |
|---|---|
| `use-cases/set-welcome-tour-completed.ts` *(new)* | `SetWelcomeTourCompleted.execute(userId, completed, now?)` — stamps `now` or clears the field; `NOT_FOUND` for an unknown user. |
| `use-cases/index.ts` | Export it. |

### `packages/adapters`

| File | Change |
|---|---|
| `db/schema/core.ts` | `welcome_tour_completed_at: timestamp(withTimezone)` nullable on `core_users`. |
| `repositories/drizzle-user-repository.ts` | Map the column in `toEntity` and in the `update` patch. |
| `drizzle/0045_welcome_tour.sql` | Generated `ADD COLUMN`, plus a backfill `UPDATE` for existing rows, declared `-- data-impact: preserved`. |

### `apps/web`

| File | Change |
|---|---|
| `server/routers/user.ts` | `me` returns `welcomeTourPending`; `completeWelcomeTour` and `restartWelcomeTour` mutations. |
| `lib/container.ts` | Wire `setWelcomeTourCompleted`. |
| `app/api/auth/test-session/route.ts` | Stamp the tour complete unless `tour: "pending"`. |
| `app/(user)/layout.tsx` | Mount `WelcomeTourGate`. |
| `components/tour/tour-stage.ts` (+test) | `TOUR_PARAM`, `parseTourStage`, `withTourStage`, `shouldShowWelcomeTour`. |
| `components/tour/welcome-tour-gate.tsx` *(new)* | Reads `user.me`, `organisation.signInState` and the shared prompt dismissal; shows the dialog; completes on any exit. |
| `components/layout/sign-in-prompts.tsx` *(new)* | `SignInPromptsProvider` — holds the nomination prompt's dismissal so the tour can follow it whichever way that dialog closes (ADR-056 §4). |
| `components/organisation/organisation-sign-in-gate.tsx` | Its local `dismissed` state lifts into that provider. |
| `components/tour/welcome-tour-dialog.tsx` *(new)* | The split modal: chat types (published flows) and "Build a flow". |
| `components/tour/new-flow-step-callout.tsx` *(new)* | The Step 1 explainer tethered to the New Flow dialog. |
| `components/flow/flow-metadata-dialog.tsx` | Optional `guide` slot rendered beside the dialog content. |
| `app/(user)/flows/_content.tsx` | Open the dialog from the stage; continue to the configure page with the next stage; clear the stage on close. |
| `components/tour/flow-explainer-cards.ts` (+test) | The six cards' copy; `nextCardIndex`, `previousCardIndex`. |
| `components/tour/tour-beat-model.ts` (+test) + `use-tour-beat.ts` | Beat sequencing and the hook. |
| `components/tour/explainer-animations/*.tsx` *(new)* | One illustration per card. |
| `components/tour/flow-explainer-carousel.tsx` *(new)* | Dialog, arrows, dots, keyboard, CTA. |
| `app/(user)/flows/[id]/config/_content.tsx` + `_flow-config-header.tsx` | Open the carousel from the stage and the menu; "Start here" highlight after the CTA. |
| `components/canvas/flow-canvas-viewport.tsx` | Optional `onShowExplainer` link under the first-step button; `highlightFirstStep` pointer. |
| `components/settings/welcome-tour-card.tsx` *(new)* + `app/(user)/settings/page.tsx` | Restart button. |
| `styles/globals.css` | `wf-tour-*` keyframes with reduced-motion overrides. |

## 4. Database changes

```sql
ALTER TABLE "core_users" ADD COLUMN "welcome_tour_completed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "core_users" SET "welcome_tour_completed_at" = now();
```

Nullable column plus a backfill. No `DROP`, no `SET NOT NULL`, no unique
index. Declared `-- data-impact: preserved — existing accounts have already
signed in, so they are stamped as toured; new accounts start null`.

## 5. Implementation order

1. **Domain + application** — the user field and `SetWelcomeTourCompleted`.
2. **Persistence** — schema, repository mapping, generated migration.
3. **Transport** — router procedures, container wiring, test-session stamp.
4. **Tour models** — stage parsing, cards, beat model (tests first).
5. **Welcome modal** — gate + dialog in the layout.
6. **New Flow callout** — dialog guide slot, flows page stage handling.
7. **Carousel** — animations, carousel, config page and viewport wiring.
8. **Settings** — restart card.
9. **e2e** — `welcome-tour.spec.ts` (policy group 4).

## 6. Tests

| Layer | File | Covers |
|---|---|---|
| application | `set-welcome-tour-completed.test.ts` | Stamps now on complete; clears on restart; `NOT_FOUND` for an unknown user; repository error propagates. |
| apps/web | `tour-stage.test.ts` | Parses the two stages, ignores junk; builds the next URL; the gate rule (pending, not nominating). |
| apps/web | `flow-explainer-cards.test.ts` | Six cards in the specified order; next/previous clamp at the ends; last-card detection. |
| apps/web | `tour-beat-model.test.ts` | Advances, loops, holds the final beat under reduced motion; delays per beat. |
| e2e | `welcome-tour.spec.ts` | Group 4 — a pending user sees the modal at `/chats`; "Build a flow" survives the page load to `/flows` with the dialog open; creating the flow survives the load to the configure page with the carousel open; skipping does not re-show after reload. |

No component test framework exists in `apps/web` (no jsdom), so the
presentational pieces are covered by their models and the e2e spec.
