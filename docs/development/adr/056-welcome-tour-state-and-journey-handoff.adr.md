# ADR-056 — Welcome Tour State and Journey Hand-off

- **Status**: Accepted (scoped by `first-login-welcome-tour.prd.md`)
- **Date**: 2026-09-04
- **Assumes**: ADR-038 §4 (organisation sign-in gate), ADR-041 (admin
  first-run wizard), ADR-008 (canvas on React Flow).

## Context

The first-login welcome tour spans three pages — any `(user)` page, the flows
list, and the flow configure canvas — and two page loads. Three things need
deciding: where "has this person seen the tour" lives, how the journey knows
which page it is on after a navigation, and how the six animated explainer
cards are sequenced so they respect reduced motion without a second set of
assets.

## Decision

### 1. Tour completion is a timestamp on the user row

`core_users.welcome_tour_completed_at timestamptz NULL`, surfaced as
`User.welcomeTourCompletedAt`. Null means pending. The migration backfills
`now()` for every row that exists when it runs: those accounts have already
signed in, so a "first login" tour would be a nag, and Settings offers a
restart for anyone who wants it.

Rejected: a browser-side flag (`localStorage`) — it would replay the tour on
every device and vanish on a cleared cache; and a separate `app_user_tour`
table — one nullable column on the existing row is the whole requirement.

The stamp is written through the existing `UpdateUser` path via a dedicated
`SetWelcomeTourCompleted` use case, so the router never assembles a
`UserUpdate` patch itself.

### 2. The journey hands off through a `tour` URL stage

Choosing "Build a flow" navigates to `/flows?tour=new-flow`; creating the flow
navigates to `/flows/<id>/config?tour=flow-explainer`. Each page reads the
stage on mount, opens what the stage asks for, and clears the parameter the
moment the stage is dismissed. The stage is an enum parsed by
`parseTourStage`; any other value is ignored.

Rejected: React context or a store — it does not survive `router.push` into a
server-rendered page reliably, and it hides state a person may want to link
to; and persisting the stage on the user row — it would make a half-finished
tour follow the person to every page until they finish it.

The tour is marked complete the moment a path is chosen in the welcome modal,
not at the end of the journey. A person who abandons the flow dialog is not
re-prompted on every page; they restart from Settings if they want.

### 3. Animations are beat-sequenced in JS, drawn by CSS

Each card's illustration is a small React component driven by a `beat`
counter from `useTourBeat(durations)`. Elements render from the beat
(`beat >= 2` shows the second bubble); CSS transitions and a handful of
keyframes do the fading, typing and connector drawing. The hook advances on
`setTimeout` per the durations and loops. Under
`prefers-reduced-motion: reduce` the hook pins the counter to the final beat,
so every illustration holds its finished frame with no second asset.

Rejected: pure CSS keyframe timelines per element — sequencing six cards of
staggered reveals purely in keyframe percentages is unreadable and untestable;
the beat model is a pure function with tests. The existing drag-to-join demo
(`DisconnectedStepsWarning`) stays pure CSS: it is one gesture, not a story.

### 4. The welcome gate yields to the organisation gate

Both are mounted in the `(user)` layout, inside `SignInPromptsProvider`. Two
stacked modals on a first sign-in is the outcome this avoids.

Yielding is on *whether the nomination dialog is on screen*, not on the raw
`organisation.signInState`. The two differ: confirming a choice invalidates
that query and the status changes, but "Not now" closes the dialog without
writing anything, and `signInState` is derived from the stored user and config,
so it reports `nominate` again on every later page load. A gate waiting on the
status alone would hide the tour permanently from anyone who declines — and the
prompt is deliberately declinable (ADR-038 §4). The provider therefore holds
the dismissal, both gates read it, and the tour shows as soon as the dialog
closes by either route.

### 5. Test users are toured by default

`POST /api/auth/test-session` stamps the tour complete on every call unless the
body carries `tour: "pending"`. The e2e suite's shared admin session therefore
never meets the modal, and the one spec that covers the tour asks for a
pending user explicitly.

## Consequences

- One nullable column, one backfill, no new table.
- Any page can start or resume the journey by linking to a stage.
- Illustrations are testable at the sequencing layer and accessible by
  construction: `aria-hidden`, copy carries the lesson, reduced motion holds
  the last frame.
- Restarting the tour is one mutation and a redirect.
