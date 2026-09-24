# Implementation summary — the latest reply no longer shows twice in a chat

- **Version**: 0.28.25 → **0.28.26** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: [`fix-chat-duplicate-reply.md`](./fix-chat-duplicate-reply.md) (this folder)
- **Source issue**: [#308](https://github.com/rbrasier/wayfinder/issues/308)

## Root cause

The chat feed renders the persisted transcript and appends the streamed entries
past the persisted count. Between turns the page re-syncs the streamed list from
the transcript, but skipped whenever the streamed list was longer. Once that
list holds an entry the server never saved — a resend of an unanswered message,
which `persistUserMessage` deduplicates by design, or a failed send followed by
a new message — it stays one longer forever, the resync never runs, and the
appended tail is the latest reply the transcript already showed.

## Fix applied

- `apps/web/src/components/chat/stream-resync.ts` (new) —
  `shouldResyncStreamedMessages`: re-sync when no turn is in flight, the last
  turn did not error, the persisted data was fetched after the last turn was
  sent or settled, and the two lists differ by id. Fetch time replaces the
  length guard as the protection against stale data.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx` — stamps the turn
  boundary on send, kickoff, retry, `onFinish` and `onError`; feeds
  `sessionQuery.dataUpdatedAt` into the helper; and, when a new message is sent
  after an errored turn, resets the streamed list to the transcript first so the
  unsaved leftovers cannot offset the next turn. Retry is unchanged.

## Regression tests added

`apps/web/src/components/chat/stream-resync.test.ts` — seven cases. *re-syncs
when the streamed list holds an entry the server deduplicated away (#308)*
failed against the old length-guard rule and passes now; the rest pin the
stale-refetch, in-flight, Retry and in-sync behaviour the old guard protected.

## E2E

None. Client-side list reconciliation falls in none of the six groups in
`docs/guides/e2e-test-policy.md`; the unit test above is the guard.

## Deviations from the approved summary

Version is 0.28.26, not the approved 0.28.24 — release/alpha-2 moved to 0.28.25 while this was in review.

## Known limitations

- A chat already showing the duplicate heals on its next completed turn (or a
  reload), not instantly.
- While an errored turn's banner is showing, the streamed list is not re-synced,
  so Retry keeps the failed message — a collaborator's message arriving in that
  window still renders from the transcript.
