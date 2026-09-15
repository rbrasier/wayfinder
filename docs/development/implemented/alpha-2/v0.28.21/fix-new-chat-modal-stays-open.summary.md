# Implementation Summary — The new-chat dialog stayed open on top of the chat it opened (v0.28.21)

- **Version**: 0.28.20 → **0.28.21** (PATCH — no schema change)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: `fix-new-chat-modal-stays-open.md` (this folder)
- **Source issue**: none

## Symptom

With the "Choose a workflow" dialog open, picking a workflow created the session
and opened the chat — and left the dialog sitting on top of it, backdrop and all,
to be closed by hand. Not every time, which made it read as flakiness.

## Root cause

`new-chat-modal.tsx` never closed itself on the success path. The
`session.create` mutation's `onSuccess` invalidated the session list and pushed
the route, and nothing else. `open` is owned by the parent and was only ever
cleared by `onClose` — wired to Cancel, the close button, and Radix's dismiss
handler, all three user-driven. Choosing a workflow is the one exit from the
dialog that goes through none of them.

The intermittency was two mount points with different lifetimes, not timing.
`ChatsContent` owns one copy and unmounts during `/chats → /chats/<id>`, taking
`newChatOpen` with it, so that copy appeared to close itself. `AppSidebar` owns
the other and is rendered by `app/(user)/layout.tsx`, which is shared by both
routes — it survives the navigation with `newChatOpen` still `true`, and the
missing close becomes visible. The defect was in the component either way; the
page instance was masking it.

The delayed appearance was `BusyOverlay` at `z-[200]` covering the `z-50` dialog
for the whole wait. `useNavigationBusy` clears on the pathname change, the
overlay lifts, and the dialog is revealed — which reads as it coming back rather
than never having left.

## Fix

`handleSessionCreated` in a new pure `new-chat-model.ts` takes the session id and
the three effects the success path fires — `closeDialog`, `refreshSessionList`,
`navigateToSession` — and runs them in that order. `new-chat-modal.tsx` supplies
them from `onClose`, `utils.session.list.invalidate` and `router.push`.

Closing before navigating, rather than after, is deliberate: the sidebar's copy
outlives the navigation, so a close queued behind `router.push` would be a state
update on a component mid-transition.

The extraction is what makes the ordering testable at all — `apps/web` has no
DOM-rendering harness, so a pure model with a test beside it is how this codebase
guards component logic (`sidebar-model.ts` / `sidebar-model.test.ts`).

`BusyOverlay` is untouched and still covers the wait: it is a sibling of the
`Dialog`, driven by `busy.busy` rather than `open`, and the component stays
mounted with `open={false}`.

## Regression test

`apps/web/src/components/chat/new-chat-model.test.ts` — 4 guards:

| Guard | Failed before because |
|---|---|
| closes the dialog | `Cannot find module './new-chat-model'` — the close did not exist in any form |
| closes **before** navigating | as above; this is the ordering the sidebar's surviving instance depends on |
| refreshes the session list | guards behaviour that already worked against being lost in the extraction |
| navigates to the session created | as above |

Written first and run failing (module not found), then made to pass. Full suite
green afterwards: 94 web test files, `./validate.sh` 24 passed / 0 failed.

## E2E

None added. The behaviour is dialog state inside one client component and falls
into none of the six groups in `docs/guides/e2e-test-policy.md` — not auth
lifecycle, streaming, file transfer, navigation state across a page load,
accessibility, or smoke. The regression test is the guard and runs on every
`./validate.sh`.

## Deviations from the approved summary

None.

## Not fixed here

Two owners of the same dialog (`ChatsContent` and `AppSidebar`) is worth
collapsing to one, but it is a refactor rather than this defect. With the fix in
place both instances behave identically.
