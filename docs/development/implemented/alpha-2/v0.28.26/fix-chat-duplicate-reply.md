# Bug fix — the latest assistant reply shows twice for the rest of a chat

- **Severity**: minor — display only; the saved conversation is intact and a page reload clears it
- **Base branch**: `release/alpha-2`
- **Source issue**: [#308](https://github.com/rbrasier/wayfinder/issues/308) ("Duplicate responses")

## Symptom

In some chats the assistant's latest reply appears twice at the bottom of the
transcript, and once it starts it repeats on every turn until the page is
reloaded. The second copy has no timestamp and no ⓘ button — it is rendered from
the streamed (client) list, not from a persisted row.

## Reproduction

1. Send a message in a chat and leave without a saved reply (the turn errored,
   or the tab closed mid-turn) — the user message is persisted, no reply is.
2. Reload the chat and send the **same text** again.
3. The server's retry idempotency (`RunTurnUseCase.persistUserMessage`) reuses
   the saved user row instead of inserting a second one, so the reply is saved
   against it — but the client list has gained an extra user entry.
4. From here on, every assistant reply shows twice.

The same drift follows a send that fails before anything is persisted (409 turn
in progress, 429 rate limit, network error) when the operator then types a new
message instead of pressing Retry.

## Root cause, as verified

The feed renders the persisted transcript and appends
`streamingTail(streamingMessages, dbMessages.length)` — the streamed entries past
the persisted count (`message-feed.tsx`). That is correct only while the two
lists line up one-for-one.

Between turns, `_content.tsx` re-syncs the streamed list from the persisted
history, but skips whenever `dbMessages.length < messages.length` — a guard meant
to stop a stale refetch clobbering a just-finished turn. Once the client list
holds one entry the server never saved (the deduplicated resend, or a failed
send), it is *always* longer than the persisted list, so the resync never runs
again and the tail is permanently off by one: it is the latest reply, which the
persisted list already rendered.

The screenshot on the issue matches: a user message 21 h old answered 23 min ago
with no duplicate user row, and a trailing copy with no timestamp.

The triage comment attributed this to multi-part replies. Those make the
persisted list *longer* than the streamed one, which yields an empty tail and a
successful resync — no duplicate. Its proposed id-based tail cannot work either:
streamed ids are generated client-side and never equal persisted ids.

## Fix plan

- New pure helper `shouldResyncStreamedMessages`
  (`apps/web/src/components/chat/stream-resync.ts`): resync when no turn is in
  flight, the last turn did not error, the persisted data was fetched after the
  last turn settled, and the two lists differ by id. Freshness replaces the
  length guard as the stale-data protection.
- `_content.tsx`: record when each turn settles (`onFinish`/`onError`), feed the
  query's `dataUpdatedAt` into the helper, and — when the operator sends a new
  message after an errored turn — reset the streamed list to the persisted
  history first so the unsaved leftovers do not offset the next turn. Retry
  (`reload`) is untouched.
- Regression test in `stream-resync.test.ts`; no e2e (not one of the six policy
  groups).

## Approved change summary

The chat screen shows a reply twice when its streamed message list gets one entry
ahead of the saved conversation — which happens when someone resends a message
the server already has, or types something new after a failed send. Once that
happens, the between-turn resync never runs again, so the latest reply is
repeated every turn. The fix re-syncs the streamed list to the saved conversation
after every settled turn once fresh data arrives, and clears failed-send
leftovers before the next message goes out.

- **Goal**: the latest reply no longer shows twice; a drifted chat heals on its next turn.
- **Rule**: once a turn settles and fresh persisted data has arrived, the on-screen
  transcript matches the saved conversation. Retry after a failed send still
  resends the failed message; a new message after a failed send drops the unsaved
  leftovers first.
- **Files**: `apps/web/src/components/chat/stream-resync.ts` (+ test),
  `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`.
- **Database**: none.
- **Tests**: regression unit test first; no e2e.
- **Version**: 0.28.25 → 0.28.26; branch `bugfix/chat-duplicate-reply/claude-rbrasier` → PR into `release/alpha-2`.
- **Out of scope**: the server's retry dedupe (intended), the triage comment's id-tail proposal.
