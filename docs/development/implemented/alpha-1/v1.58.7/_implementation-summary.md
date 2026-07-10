# v1.58.7 — Fix cross-check chat feedback (missing generating pill, replaced messages, no scroll, sticky Proceed)

## Symptoms

Reported in testing on `generate_document` flows with context docs:

1. After a cross-check failed and the step later crossed the threshold again,
   the "Generating document…" pill never showed (Test 1a).
2. A passing cross-check gave no feedback and the session did not appear to
   auto-advance (Test 1b).
3. After the cross-check the chat appeared to replace one message with another
   instead of only ever appending new messages (Test 1c).
4. New messages / pills did not always scroll the feed to the bottom (Test 1d).
5. Clicking Proceed on a confirmation-gated step kept the button on screen
   until the document finished generating (Test 2).

## Root causes

1. **Fail path rewrote the conversation** — the route streamed the corrective
   follow-up into the *same* assistant bubble (one data-stream response is one
   UI message) and deliberately never persisted the overruled reply, so the
   streamed→persisted view swap replaced the concatenated bubble with the
   follow-up alone.
2. **No pass feedback** — a passing cross-check emitted nothing.
3. **Stale streamed history** — `useChat`'s list never learns of
   server-persisted messages (gap follow-ups, openers, notes), so the next
   turn's streaming view rendered an older history and messages vanished
   mid-turn.
4. **Scroll only fired on message-count changes** — streamed text growth,
   annotation badges (cross-checking / generating-document), milestone pills
   and the view swap all grow the feed without changing either count, so the
   generating pill rendered below the fold: this is why it "didn't show" and
   why an advance looked like a stall.
5. **Proceed had no optimistic UI and no generation signal** — the confirm
   mutation synchronously generates the document and opens the next step; the
   card stayed mounted until it resolved, and the Proceed path never wrote a
   `generating-document` signal (explicitly omitted in v1.58.6).

## Fix

Server (`turn-helpers.ts`, `route.ts`):

- `persistHeldReply` — the gate's fail path now persists the overruled reply
  before streaming the follow-up, so nothing is ever rewritten.
- `streamGapFollowup` writes a `finish_step` boundary first, so the follow-up
  arrives as a new bubble instead of appending onto the reply it corrects.
- `writeCrossCheckPassNote` / `persistCrossCheckPassNote` — a passing
  cross-check streams (immediately, behind a boundary) and persists a system
  note: "Cross-check complete — everything is in alignment with the reference
  documents."

Client (`message-feed.tsx`, `message-segments.ts`, `document-poll-state.ts`,
`_content.tsx`, `confirm-step-card.tsx`):

- `messageTextSegments` — streamed messages render one bubble per text part
  (split at `finish_step` boundaries), matching the persisted rows exactly.
- Between turns the streamed list is re-synced from the persisted history
  (`setMessages`), so openers/follow-ups/notes never vanish mid-turn.
- Stick-to-bottom scrolling: the feed tracks whether the viewer is at the
  bottom and follows any growth (text, badges, pills, view swaps), not just
  message-count changes.
- Optimistic Proceed: the confirmation card unmounts on click and the
  `GeneratingDocumentBadge` shows in the feed while the mutation runs (for
  template-backed document steps); the card returns on error.
- `hasPendingDocumentGeneration` — the fast document poll now only considers
  the *last* assistant message per node, so persisted held replies (high
  confidence, no document) cannot poll forever.

## Regression tests added

- `turn-helpers.test.ts` — `persistHeldReply` persists the overruled reply on
  the current node and swallows failures; the pass note streams behind a
  `finish_step` boundary and persists as a system message; `streamGapFollowup`
  writes the boundary before the follow-up.
- `message-segments.test.ts` (new) — one segment per text part; content
  fallback; ignores empty/non-text parts.
- `document-poll-state.test.ts` (new) — only the last assistant message per
  node keeps the poll alive; held replies, failed/complete documents, current
  node and template-less nodes do not.
- `apps/web/e2e/fix-cross-check-chat-feedback.spec.ts` (new, /e2e skill) —
  fail path appends rather than rewrites; the generating pill is visible and
  in-viewport; the pass note appears; Proceed hides immediately with the pill
  shown during the wait.

## Validation

`./validate.sh` — all checks pass (infrastructure-dependent checks skip in the
sandbox: no database reachable).

## Version

PATCH: `1.58.6` → `1.58.7` (bug fix, no schema change).
