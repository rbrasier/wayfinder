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

## CI: a pre-existing e2e trap, fixed in passing

The first CI run on this branch failed shard 1/3 with two failed and four flaky
chat specs. None of them is this change's: they never touch the New Chat modal
or any other surface here, and all reach a chat by `page.goto('/chats/<id>')`.
Every failure carried the same signature — `waitForLoadState('networkidle')`
timing out after 30s.

That is a trap this repo has already written down. From
`docs/development/e2e-triage-handover.md` §4: *"`networkidle` cannot fire on a
session page. An open SSE connection means the network is never idle; the wait
can only burn the test timeout."* The same wait had already been removed from
other specs for exactly this reason; these five files still carried it.

Rather than re-run and hope, the known fix is ported here: all 13 session-page
`networkidle` waits are replaced with a wait for the chat composer, which is
what "the session page is ready" actually means. That includes five sites in
`chat-transparency.spec.ts` and `chat.spec.ts` that happened to pass this run —
leaving them armed would just move the red to a different shard next time.

Two of the sites gain strength from the change rather than merely losing a bad
wait: the "no JS errors on the session page" checks in `chat.spec.ts` and
`chat-confidence.spec.ts` previously counted console errors after a wait that
could not settle, and now count them after the page is genuinely interactive.

### Follow-up: the tour spec's own flakiness

The run that went green (#816: 134 passed, 0 failed) still listed both
`welcome-tour.spec.ts` tests as flaky — passing only on retry. Left alone that
is the beginning of a spec nobody trusts, so both causes were fixed rather than
accepted.

- `expect(page).toHaveURL(/\/flows\?tour=new-flow$/)` failed with the URL still
  at `/chats` after 14 retries. Every hand-off in this journey lands on a
  server-rendered page, and the App Router only changes the URL once that page's
  RSC payload arrives — so under a loaded runner the wait exceeded Playwright's
  5s expect default. The URL assertions now carry an explicit `NAV_TIMEOUT`.
- `page.goto('/settings')` timed out at 30s `waiting until "load"`. Document
  navigations in this spec now wait for `domcontentloaded`; every step after one
  is a retrying assertion, so a parsed document is a sufficient starting point.

The two "the tour does not come back" assertions were also re-anchored, from the
server-rendered page heading to the sidebar's account button. That button renders
only once `user.me` resolves — the same query the gate reads — so the absence is
now asserted at a point where the gate demonstrably had the data to show
something, rather than possibly before it.

**A correction to the above.** Switching `page.goto('/settings')` to
`domcontentloaded` traded one problem for a worse one: the restart button is
server-rendered, so Playwright could click it before React had hydrated, and the
click was swallowed with no handler attached. The next run failed outright —
the URL sat on `/settings` for the full 20s across 39 retries. `domcontentloaded`
is kept, because the wait itself was never the problem, but anything that
*clicks* after a navigation now first waits for the sidebar's account button,
which is driven by a client `user.me` query and so proves hydration.

Separately, the CI console log carried a Radix warning — *Missing `Description`
or `aria-describedby` for {DialogContent}* — from the welcome modal, which had a
title but no description. It now has an `sr-only` one naming the two halves
before a screen reader reaches them. No visual change.

The first attempt at that gave the description an id of our own and pointed
`aria-describedby` at it, and the warning survived. Reading
`@radix-ui/react-dialog` settles why: `DescriptionWarning` looks up **its own**
generated `descriptionId` with `document.getElementById`, so supplying a
different id defeats the check rather than satisfying it. The description now
carries no id and Radix wires its own. The same mistake had been made on
`FlowMetadataDialog`'s `guide` slot, whose `aria-describedby` is removed for the
same reason — the callout renders inside the dialog, so assistive technology
reaches it as part of the dialog's content without it.

## Known limitations

- The overlay covers the viewport, so a slow `session.create` blocks the whole
  page rather than just the modal. That is the intended trade: the action ends
  in a navigation, so there is nothing useful to do on the page behind it.
