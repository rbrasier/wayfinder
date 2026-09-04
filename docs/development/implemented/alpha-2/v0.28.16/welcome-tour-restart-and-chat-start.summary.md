# Bug Fix Summary — Welcome Tour Restart, and Feedback When Opening a Chat or Flow (v0.28.16)

- **Version**: 0.28.16 — **PATCH** (two UI defects, no schema impact)
- **Base branch**: `release/alpha-2`
- **Fixes**: defects in v0.28.15 (`first-login-welcome-tour`), reported after it merged
- **ADR**: `docs/development/adr/056-welcome-tour-state-and-journey-handoff.adr.md`

## Bug 1 — restarting the welcome tour worked only once per page load

**Symptom.** "Restart the welcome tour" in user settings worked the first time.
Every attempt after that did nothing at all — no modal, no error, no failed
request. A full browser reload made it work again, once.

**Root cause (verified).** `WelcomeTourGate` held a `dismissed` flag in React
state as an optimistic hide, so the modal closed on the click rather than after
the completion round-trip. The gate is mounted in the `(user)` layout, which
stays mounted across client-side navigation — so the flag outlived the tour it
closed. Walking to Settings and restarting cleared the server stamp and set
`welcomeTourPending` back to `true`, but the stale flag still short-circuited
`shouldShowWelcomeTour`. Only a document load, which remounts the layout, reset
it. Restarting twice within one page load reproduces it every time.

**Fix.** The flag is removed rather than reset. Completing the tour now writes
the completion straight into the `user.me` query cache in `onMutate`, which the
gate already reads, so the modal still closes on the click and a restart
legitimately overturns it. `shouldShowWelcomeTour` no longer takes a `dismissed`
input at all, so no local flag can outlive the state it mirrors. There is
deliberately no rollback on error: a failed stamp means the tour really is still
pending, but re-opening the modal someone just closed is worse than letting it
return on their next page load.

## Bug 2 — starting a chat looked like nothing had happened

**Symptom.** Choosing a chat type — from the welcome modal or the New Chat
modal — left the person waiting with no feedback before the chat page appeared.

**Root cause (verified).** The action is two waits back to back: the
`session.create` round-trip, then the navigation to a server-rendered page.
Neither was covered. During the mutation only the cards' `disabled` styling
changed. During the navigation `NavigationProgress` — the 2px top bar — never
started, because it listens for anchor clicks (`closest("a")`) and this is a
`router.push` from a button. The pre-existing New Chat modal had the same gap;
the tour inherited it.

**Fix.** `BusyOverlay`, a blocking page-covering spinner, is held across both
phases by `useNavigationBusy`. That hook clears on a pathname change — the
moment the destination is actually on screen — so the overlay can never outlive
the navigation it was raised for, including in the gate, which survives the
navigation. Chosen over the alternative of navigating first: the session id does
not exist until the server answers, so there is nowhere to navigate to.

## Bug 3 — opening a flow config looked like nothing had happened

**Symptom.** The same complaint as bug 2, reported separately against the flow
config canvas: clicking "Configure Flow", or saving a new flow, left the list on
screen with no sign the click had registered.

**Root cause (verified).** Two causes, one shared with bug 2 and one its own.
Creating a flow ends in a `router.push` from a button, so `NavigationProgress`
never starts — identical to the chat case. But `/flows/[id]/config` also has **no
`loading.tsx`**, where `/chats/[sessionId]` has one. Without that Suspense
boundary the App Router holds the previous page on screen for the whole of a
heavy server render, so even the "Configure Flow" anchor — which does start the
top bar — showed nothing else changing.

**Fix.** Both halves. `BusyOverlay` now covers all four routes into the canvas:
create and "Configure Flow" on the user list, and the same pair on the admin
list, which had the identical gap. And the route gains a `loading.tsx` — a
canvas-shaped skeleton mirroring the chat route's — so every other way in is
covered too: a typed URL, back/forward, and the `/admin/flows/[id]` redirect,
none of which pass through a click the overlay could hook.

## Files changed

| File | Change |
|---|---|
| `apps/web/src/components/ui/busy-overlay.tsx` *(new)* | The blocking overlay: spinner, label, above the dialog (z-200) and the nav bar (z-100). |
| `apps/web/src/lib/use-navigation-busy.ts` *(new)* | Busy state across both waits, cleared on a pathname change. |
| `apps/web/src/components/tour/welcome-tour-gate.tsx` | Optimistic cache write replaces the `dismissed` flag; overlay rendered outside the `show` guard, since choosing a path closes the dialog while the wait runs on. |
| `apps/web/src/components/tour/tour-stage.ts` (+ test) | `shouldShowWelcomeTour` drops its `dismissed` input. |
| `apps/web/src/components/chat/new-chat-modal.tsx` | Same overlay on the pre-existing modal. |
| `apps/web/src/app/(user)/flows/[id]/config/loading.tsx` *(new)* | Canvas-shaped skeleton, so the route stops holding the previous page during its server render. |
| `apps/web/src/app/(user)/flows/_content.tsx` | Overlay on create and on "Configure Flow". |
| `apps/web/src/app/(admin)/admin/flows/_content.tsx` | The same two, which had the identical gap. |
| `apps/web/e2e/welcome-tour.spec.ts` | The regression guard. |
| `VERSION`, `package.json` | 0.28.15 → 0.28.16. |

## Regression test

`welcome-tour.spec.ts` gains "restarts from Settings repeatedly within one page
load", which skips and restarts three times in a row, navigating to Settings
through the sidebar account menu rather than `page.goto`. That detail is the
test: a `page.goto` between rounds would reload the document and remount the
layout, which is exactly what masked the bug in manual testing. Policy group 4
(navigation state across a page load).

Bugs 2 and 3 have no automated test. The defect is "the waiting state was
invisible", which is a rendering fact with no assertion below the browser and no
natural Playwright hook — the overlay's lifetime is bounded by a navigation the
test would have to race. They were verified by rendering the overlay over the
welcome modal, and the new canvas skeleton, in a headless-Chromium harness
instead.

## Known limitations

- The overlay covers the viewport, so a slow `session.create` blocks the whole
  page rather than just the modal. That is the intended trade: the action ends
  in a navigation, so there is nothing useful to do on the page behind it.
