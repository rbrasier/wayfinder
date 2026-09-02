# Implementation Summary — No recovery when a flow takes the wrong branch at a fork

- **Version**: 0.28.12 (bump: **PATCH** — recovery path for an existing
  behaviour; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`
- **Bug-fix doc**: [`flow-fork-recovery.bugfix.md`](./flow-fork-recovery.bugfix.md)

## Root cause

Two gaps, both verified in the code rather than inferred.

**1. `OverrideBranch` is forward-only.**
`packages/application/src/use-cases/session/override-branch.ts` filters
`edges.filter((e) => e.fromNodeId === session.currentNodeId)` — it can only pick
a branch leaving the node the session is *parked on*. Once a session advances
past a fork, that fork's edges leave the candidate set, so a wrong branch cannot
be revisited by any existing path.

**2. Its picker is unreachable in this situation anyway.** In
`apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`,
`showBranchOverride = isAdmin && !isReadOnly && stallCount >= NULL_BRANCH_THRESHOLD`
— admin-only, and gated on three stalled high-confidence turns on a forked node.
A branch that resolves cleanly to the *wrong* target never stalls, so the
threshold is never met and the picker never appears.

The insight loss is a consequence, not a separate defect. Insights are derived
from the transcript — `accumulateInsights` and `buildGatheredContext` both read
every assistant message's `aiPayload.contextGathered` — so it is *abandoning the
session* that destroys them. Moving a session without deleting messages preserves
them by construction, which is what this fix does.

## Fix applied

- **`packages/domain/src/entities/flow-graph.ts`** — the transitive closure that
  was computed privately for fork-sibling grouping is factored into
  `buildOutgoing` / `walkFrom` and exposed as `reachableNodeIds(edges, start)`.
  No behaviour change to `computeForkSiblingGroups`.
- **`packages/domain/src/entities/fork-rewind.ts`** (new) — two pure helpers:
  `visitedNodeIdsInOrder(messages, currentNodeId)`, the steps a session has stood
  on, ordered by latest visit (the same "latest wins" rule as
  `takenPathNodeIds`); and `abandonedBranchNodeIds(edges, rewind, visited)`,
  which is a set difference rather than "everything after the fork" — where two
  branches rejoin, the shared tail is still on the path being taken, and the fork
  itself is being returned to.
- **`packages/application/src/use-cases/session/rewind-to-fork.ts`** (new) —
  `RewindToFork` validates that the session is active, the fork is a step it
  visited, the fork has more than one outgoing edge, and the target is one of
  those edges. It then moves `currentNodeId`, clears
  `awaitingConfirmationNodeId`, writes `rewind` and `abandonedNodeIds` onto the
  existing `graph_checkpoint` jsonb, and appends a `system` message naming the
  fork and both branches. **Nothing is deleted** — no message, step output or
  document.
- **`apps/web/src/server/routers/session.ts`** — `session.rewindToFork`, owner or
  admin only (rejecting read-only shared participants, mirroring `confirmStep`).
  It passes the nodes and edges resolved by `GetSession` into the use case, so
  the fork is validated against the flow *version the session is pinned to*
  (ADR-015) rather than the live rows — the pinning bug `OverrideBranch` still
  has.
- **`apps/web/src/lib/chat/fork-history.ts`** (new) — `toForkHistory` derives the
  forks a session actually branched from, most recent first, reusing
  `toBranchOptions` so each branch carries the author's stated rule. A fork the
  session is merely parked on is excluded: nothing has been chosen there yet.
- **`apps/web/src/components/chat/rewind-fork-modal.tsx`** (new) — fork list with
  "Took: *branch*", then that fork's branches with the taken one badged. The most
  recent fork opens pre-selected. Empty state when no fork has been passed.
- **`apps/web/src/components/chat/chat-actions-menu.tsx`** — **Go back to a fork**
  menu item, hidden for read-only viewers and when `onGoBackToFork` is absent
  (which is how a chat with no fork behind it shows no dead end). Menu widened
  `w-44` → `w-48` so the label does not wrap.
- **`apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`** — wires the modal
  and mutation, and drops `abandonedNodeIds` out of `completedNodeIds` so the
  step rail stops showing the abandoned branch as done.
- **`apps/web/src/lib/container.ts`**, `use-cases/session/index.ts`,
  `entities/index.ts` — wiring and exports.

## Regression tests added

- **`packages/application/src/use-cases/session/rewind-to-fork.test.ts`** — 13
  cases. The guard is *"keeps every insight gathered before and during the
  abandoned branch"*: it runs `accumulateInsights` over the transcript after the
  rewind and asserts all three insights survive, including the one gathered on
  the branch being left. Alongside it: the session moves, the pending
  confirmation clears, the checkpoint records the rewind, `abandonedNodeIds` is
  the exclusive part of the abandoned branch, the system note names both
  branches, and five refusal cases (non-branch target, unvisited fork, non-fork
  step, a fork not yet branched from, a finished session).
- **`packages/domain/src/entities/fork-rewind.test.ts`** — 11 cases: visit
  ordering (latest visit wins, unanchored turns ignored, current node not
  duplicated) and the abandoned-set difference (fork excluded, rejoin node kept,
  re-picking the same branch abandons nothing).
- **`packages/domain/src/entities/flow-graph.test.ts`** — 5 added cases for
  `reachableNodeIds`, including the cycle that makes the start node reachable
  from itself.
- **`apps/web/src/lib/chat/fork-history.test.ts`** — 7 cases: fork derivation,
  single-edge steps ignored, a parked-on fork ignored, most-recent-first order,
  and a fork worked twice reporting its second branch.

`./validate.sh` — 23 passed, 1 failed. The single failure is
`high or critical vulnerabilities found`, which is **pre-existing and unrelated**:
transitive advisories in `jsondiffpatch`, `browserslist` and `fast-uri`. Verified
by stashing this change and re-running `./scripts/audit-check.sh` on the
untouched base branch, which fails identically. No dependency or lockfile change
is part of this fix.

## E2E decision

**No Playwright spec added.** The fixed behaviour is a state mutation behind a
modal — it falls into none of the six groups in
`docs/guides/e2e-test-policy.md` (auth session lifecycle, streaming into the DOM,
file upload/download, navigation state across a page load, accessibility,
smoke). The regression tests above are the guard and run on every
`./validate.sh`.

## Deviations from the approved summary

- The approved summary had `RewindToFork` reading edges from a repository. It
  takes the resolved `nodes`/`edges` from `GetSession` instead, so validation
  runs against the pinned flow version the operator was actually shown. Reading
  the live rows — as `OverrideBranch` does — would reject a fork visible on
  screen whenever the flow had been republished since the chat started.
- `visitedNodeIdsInOrder` went into `packages/domain` rather than
  `apps/web/src/lib/chat/`, because both the use case and the client need it and
  the application package may not import from an app.
- No other deviations.

## Known limitations

- Step outputs and generated documents from the abandoned branch are kept, not
  tombstoned. `takenPathNodeIds` dedupes to the latest output, so approval
  route-back stays coherent, but a stale document from the abandoned branch
  remains downloadable from the transcript.
- Only the most recent rewind is recorded on the checkpoint; there is no rewind
  history and no undo.
- The rewind cannot target a non-fork step — "go back one step" is still not
  possible.
- A flow with a cycle routing back through the fork reports fewer abandoned
  nodes rather than more, so the rail errs towards showing a step as complete.
- The existing admin-only `OverrideBranch` stall picker is unchanged, including
  its own live-rows-vs-pinned-version inconsistency.
