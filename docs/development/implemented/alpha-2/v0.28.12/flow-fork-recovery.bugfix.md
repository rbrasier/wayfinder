# Bug Fix — No recovery when a flow takes the wrong branch at a fork

- **Status**: Implemented
- **Target version**: **PATCH** — **0.28.12** (behaviour fix, no schema change)
- **Base branch**: `release/alpha-2` (affects the shipped alpha-2 build)
- **Branch**: `claude/flow-fork-recovery-modal-waivuo`
- **Severity**: Minor — a workaround exists (abandon and restart) but it destroys
  the session's gathered insights

## 1. Symptom

A forked step routes the session down the wrong branch. The operator has no way
to go back: the chat is stuck on a branch that does not apply to the case in
front of them. The only escape is abandoning the chat and starting again, which
throws away every insight the session had gathered.

## 2. Reproduction

1. Run a flow whose step B forks to `Fast track` and `Full review`.
2. Answer step B such that the branch-choice model routes to `Fast track`.
3. Work one step down `Fast track`, so insights accumulate on that branch.
4. Realise the case actually needed `Full review`.
5. Open the chat three-dot menu — Rename, Abandon, Show data, Share,
   Collaborate. Nothing goes back.

## 3. Root cause (verified)

Two separate gaps, both confirmed by reading the code rather than inferred:

1. **`OverrideBranch` is forward-only.** `packages/application/src/use-cases/session/override-branch.ts`
   filters `edges.filter((e) => e.fromNodeId === session.currentNodeId)` — it can
   only pick a branch leaving the node the session is *parked on*. Once the
   session has advanced past the fork, the fork's edges are no longer in that
   set, so the wrong branch cannot be revisited.
2. **The picker is unreachable in this situation anyway.** In
   `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`,
   `showBranchOverride = isAdmin && !isReadOnly && stallCount >= NULL_BRANCH_THRESHOLD`.
   It is admin-only and requires three stalled high-confidence turns on a forked
   node. A branch that resolved cleanly to the *wrong* target never stalls, so
   the threshold is never met and the picker never appears.

The insight-loss half of the symptom is a consequence, not a separate defect:
insights are derived from the transcript
(`packages/application/src/services/accumulate-insights.ts` and
`buildGatheredContext` in `turn-helpers.ts` both read every assistant message's
`aiPayload.contextGathered`), so abandoning the session is what loses them.
Moving the session without deleting messages preserves them by construction.

## 4. Fix plan

Add a **rewind to fork** path, distinct from the existing stall picker:

- `reachableNodeIds(edges, startNodeId)` exported from `flow-graph.ts` — the
  transitive closure already computed privately there.
- `RewindToFork` use case: validate the fork is a node the session visited with
  more than one outgoing edge, validate the target is one of that fork's
  outgoing edges, move `currentNodeId`, clear `awaitingConfirmationNodeId`,
  record the rewind and the abandoned node ids on the existing
  `graph_checkpoint` jsonb, and append a `system` message naming the switch.
- `toForkHistory` on the client derives the forks the session actually passed
  through from message `stepNodeId`s, each with the branch taken.
- `RewindForkModal` reached from the chat three-dot menu, for the session owner
  or an admin on an active session.
- Steps reachable *only* from the abandoned branch drop out of
  `completedNodeIds`, so the step rail stops showing them as done.

**Nothing is deleted.** Messages, step outputs and documents all stay, so the
insights gathered on the abandoned branch continue to feed the next step's
prompt — which is the explicit requirement.

## 5. Tests

- `rewind-to-fork.test.ts` — the regression guard: rewinding preserves every
  message and its `contextGathered`, moves the session, clears the confirmation
  flag, and computes `abandonedNodeIds` as the *exclusive* part of the abandoned
  branch.
- `fork-history.test.ts` — fork derivation from visited steps.
- `flow-graph.test.ts` — `reachableNodeIds`, including a cycle.
- **No e2e.** State mutation behind a modal falls into none of the six groups in
  `docs/guides/e2e-test-policy.md`; the unit tests are the coverage.
