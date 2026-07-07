# Fix cross-check chat feedback — missing generating pill, replaced messages, no scroll, sticky Proceed button

## Symptoms

Reported in testing on `generate_document` flows with context docs (follow-on
from the v1.58.x fixes):

1. **Test 1a** — after a cross-check *failed* and the step later reached the
   confidence threshold again, the "Generating document…" pill never showed.
2. **Test 1b** — on the second step the cross-check *passed*, but the session
   did not appear to auto-advance and the generating pill did not show either.
3. **Test 1c** — after the cross-check the chat appears to *replace* a message
   with another (or append onto the previous message). The chat should only
   ever append new messages: after a cross-check either a message asking for
   the shortcomings (fail) or a message stating everything is in alignment
   with the references (pass).
4. **Test 1d** — when new messages, loading pills, or step-complete pills
   appear, the feed does not always scroll to the bottom; content is cut off.
5. **Test 2** — clicking Proceed on a confirmation-gated step keeps the button
   on screen until the document has finished generating. The button should
   disappear immediately and the "Generating document" pill should show.

## Root causes (verified in code)

### 1. The gate's fail path rewrites the streamed conversation (Test 1c)

`route.ts` streams the cheap model's optimistic reply, then — when the
pre-generation evaluation fails — streams the corrective follow-up **into the
same assistant message** (the data-stream protocol concatenates all `text`
parts of one response into one UI bubble), and deliberately never persists the
optimistic reply (v1.58.5 decision). When the turn ends, `MessageFeed` swaps
from the streamed view to the DB view: the concatenated bubble is replaced by
the single persisted follow-up. The user sees a message being rewritten and
removed.

### 2. No feedback at all on a cross-check pass (Test 1b)

On a pass the route persists the reply and advances, but emits nothing that
says the cross-check succeeded. Combined with root causes 3 and 4 (below) the
advance can complete entirely below the fold, so a pass looks like a stall.

### 3. The streamed view drops server-persisted messages (Tests 1b/1c)

`useChat`'s message list only ever contains what was streamed to it. Gap
follow-ups, next-step openers (`generateInitialMessage` uses `generateObject`,
not the stream) and system notes are persisted server-side and only appear via
the tRPC refetch. On the *next* turn, `MessageFeed` switches back to the
(stale) streamed list — previously visible messages (e.g. the step opener)
vanish for the duration of the turn and reappear afterwards.

### 4. Auto-scroll only fires on message-count changes (Tests 1a/1b/1d)

`MessageFeed`'s scroll effect depends on `dbMessages.length` and
`streamingMessages.length` only. Streamed text growth, the cross-checking /
generating-document badges (annotation-driven), milestone pills, document
cards, and the streamed→DB view swap all change the feed height *without*
changing either count. The "Generating document…" badge is rendered — below
the fold. This is why the pill "doesn't show" and why an advance can look like
it never happened.

### 5. The Proceed path has no optimistic UI and no generation signal (Test 2)

`session.confirmStep` (tRPC) synchronously recomputes the branch, advances,
generates the document (awaited since v1.58.6) and opens the next step before
it resolves. `ConfirmStepCard` stays mounted (with a disabled button) until
`onSuccess` invalidates the session query. There is no stream on this path, so
no `generating-document` annotation exists at all (the v1.58.6 change
explicitly omitted it: "the Proceed path omits it").

## Reproduction

1. Start a session on a flow whose steps are `generate_document` with a
   template and context docs.
2. Give deliberately incomplete answers until confidence crosses the
   threshold → cross-check runs and fails → watch the streamed reply get
   rewritten into the follow-up (1c).
3. Supply the missing items → threshold crossed again, gate is advisory →
   document generates with the pill below the fold (1a, 1d).
4. On the next step give complete answers → cross-check passes → no feedback,
   advance happens off-screen (1b).
5. On a confirmation-gated step click Proceed → button stays until the
   document is generated (2).

## Fix plan

Server (`route.ts`, `turn-helpers.ts`):

1. **Persist the held reply** on the gate's fail path (`persistHeldReply`) so
   the streamed bubble matches a real DB row and is never rewritten. The
   milestone/gate guards already treat high-confidence messages still on the
   current node as not-advanced, so no phantom pills appear.
2. **Stream the follow-up as its own bubble** — write a `finish_step`
   data-stream part before it so the client gets a second text part.
3. **Emit a cross-check pass note** (`streamCrossCheckPassNote`): stream and
   persist a system message stating everything aligns with the reference
   documents, before the advance side effects run.

Client (`message-feed.tsx`, `_content.tsx`):

4. **Render streamed assistant messages per text part** (`messageTextSegments`)
   so the follow-up / pass note appear as separate bubbles, matching the DB
   view exactly — the view swap becomes invisible.
5. **Sync `useChat`'s list from the DB between turns** (`setMessages`) so the
   streamed view starts from the full persisted history and no message ever
   disappears mid-turn.
6. **Stick-to-bottom scrolling**: track whether the viewer is at the bottom
   and scroll on any feed growth (streamed text, badges, pills, view swaps),
   not just message-count changes.
7. **Optimistic Proceed**: hide `ConfirmStepCard` the moment it is clicked and
   show the `GeneratingDocumentBadge` in the feed while the confirm mutation
   runs (for template-backed document steps); restore the card on error.
8. **Bound the generating-doc poll to the last assistant message per node** —
   now that held replies persist with high confidence and a null
   `documentStatus`, the existing `hasGeneratingDoc` heuristic would otherwise
   poll forever after the node advances.

## Regression tests

- `turn-helpers.test.ts` — `persistHeldReply` persists the overruled reply on
  the current node; `streamCrossCheckPassNote` writes a message boundary +
  note text and persists the system note; `streamGapFollowup` writes a
  `finish_step` boundary before streaming the follow-up.
- `message-segments.test.ts` (new) — splits a streamed message into one bubble
  per text part; falls back to `content` when parts are missing.
- `document-poll-state.test.ts` (new) — only the last assistant message per
  node keeps the poll alive; a persisted held reply does not.
- `apps/web/e2e/fix-cross-check-chat-feedback.spec.ts` (new, /e2e skill) —
  fail path appends (never rewrites) messages; pass path shows the alignment
  note; Proceed hides the button immediately and shows the generating pill;
  the feed follows new pills to the bottom.

## Version

PATCH: `1.58.6` → `1.58.7` (bug fix, no schema change).
