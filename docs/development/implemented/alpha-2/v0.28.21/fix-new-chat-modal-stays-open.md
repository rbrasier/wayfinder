# Bug Fix — The new-chat dialog stays open on top of the chat it just opened (v0.28.21)

- **Version**: 0.28.21 (bump: **PATCH** — no schema change)
- **Base branch**: `release/alpha-2` (via `claude/modal-persistence-chat-open-b872et`)
- **Severity**: minor — the chat opens correctly; the dialog has to be dismissed by hand
- **Type**: `/bugfix`
- **Source issue**: none

## Symptom

With the "Choose a workflow" dialog open, picking a workflow creates the session
and opens the chat — and the dialog is still there, sitting on top of it, with
its backdrop dimming the chat behind. It has to be closed by hand before the
chat can be used.

It does not happen every time, which is what made it look like flakiness.

## Reproduction

1. Sign in and open any page under `(user)` — the sidebar is on screen.
2. Click **New chat** in the sidebar (or press the new-chat shortcut).
3. In the "Choose a workflow" dialog, click any workflow card.
4. The "Starting your chat…" overlay covers the wait, the chat page loads — and
   the dialog is still open in front of it.

Doing the same from the **My Chats** page header button does *not* reproduce it,
which is the "sometimes".

## Root cause

`new-chat-modal.tsx` never closes itself on the success path. The mutation's
`onSuccess` invalidates the session list and navigates, and that is all:

```ts
const createMutation = trpc.session.create.useMutation({
  onSuccess: (session) => {
    void utils.session.list.invalidate();
    router.push(`/chats/${session.id}`);
  },
  ...
});
```

`open` is owned by the parent and only ever cleared by `onClose`, which is wired
to the Cancel button, the close button, and Radix's dismiss handler — all three
of them user-driven. Choosing a workflow is the one exit from this dialog that
does not go through any of them.

**Why it depends on where the dialog was opened from.** Both mount points render
the same component, but they have different lifetimes across the navigation:

| Opened from | Owner | Survives `/chats` → `/chats/<id>`? |
|---|---|---|
| **My Chats** header button | `ChatsContent` (`app/(user)/chats/_content.tsx`) | No — the page unmounts, taking `newChatOpen` with it |
| **Sidebar** "New chat" | `AppSidebar`, rendered by `app/(user)/layout.tsx` | **Yes** — the layout is shared by both routes, so `newChatOpen` stays `true` |

So the page-owned copy is destroyed by the navigation and appears to close
itself; the sidebar-owned copy is not, and the same missing `onClose` becomes
visible. The bug is in the component either way — the page instance was only ever
masking it.

**Why it is invisible until the chat has loaded.** `BusyOverlay` is `z-[200]`
and the dialog is `z-50`, so the overlay covers the stuck dialog for the whole
wait. `useNavigationBusy` clears on the pathname change, the overlay lifts, and
the dialog is revealed — which reads as the dialog *re-appearing* once the chat
is open rather than never having gone away.

## Fix

Close the dialog as part of the success path, before navigating.

The handler moves into a pure `new-chat-model.ts` — `handleSessionCreated` —
taking the session id and the three effects it fires (`closeDialog`,
`refreshSessionList`, `navigateToSession`). The component supplies them and the
ordering becomes testable, which it is not inside a `useMutation` callback:
`apps/web` has no DOM-rendering test harness, so a pure model with a test beside
it is how this codebase guards component logic (`sidebar-model.ts` /
`sidebar-model.test.ts`).

Closing before navigating rather than after matters: the sidebar's copy outlives
the navigation, so a close queued after `router.push` is a state update on a
component that is mid-transition, and there is no reason to keep the dialog on
screen for even that long.

The busy overlay is unaffected — it is a sibling of the `Dialog`, driven by
`busy.busy` rather than `open`, and the component stays mounted with `open={false}`.
So the wait is still covered, and still clears on arrival.

## Regression test

`apps/web/src/components/chat/new-chat-model.test.ts`:

| Guard | Fails before the fix because |
|---|---|
| `handleSessionCreated` closes the dialog | the function does not exist; the component never called `onClose` |
| it closes **before** navigating | as above — call order is what the sidebar's surviving instance depends on |
| it refreshes the session list and navigates to the created session | guards the behaviour that already worked against being lost in the extraction |

## E2E

None. This is not one of the six groups in `docs/guides/e2e-test-policy.md` — it
is dialog state within a single client component, not auth lifecycle, streaming,
file transfer, navigation state across a page load, accessibility, or smoke. The
regression test above is the guard, and it runs on every `./validate.sh`.

## Out of scope

- Every other dialog in the app; none of them navigate away on a selection.
- `useNavigationBusy` and `BusyOverlay`, which behave correctly.
- The duplicate `NewChatModal` mount points. Two owners of the same dialog is
  worth collapsing, but it is a refactor and not this defect — with the fix in
  place both instances behave identically.
