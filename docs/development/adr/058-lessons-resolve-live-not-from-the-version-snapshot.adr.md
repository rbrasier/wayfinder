# ADR-058 — Accepted Lessons Resolve Live, Outside the Flow Version Snapshot

- **Status**: Proposed (scoped by `flow-memory.prd.md`)
- **Date**: 2026-09-05
- **Builds on**: `015-flow-versioning-snapshots` (a session is pinned to a
  published snapshot), ADR-057 (observation → lesson → owner acceptance),
  ADR-016 (per-turn blocks appended below the stable prompt region)

## Context

Every session pins itself to a flow version:

> The flow version this chat is pinned to (ADR-015). Resolved to the latest
> published version at session start; the runner reads that snapshot, not the live
> rows, so the chat stays stable across later edits/publishes/restores.

— `packages/domain/src/entities/session.ts`

That guarantee is load-bearing. An operator halfway through a twelve-step
procurement case must not have the ground move because the author republished. The
runner reads nodes and edges from `app_flow_versions.snapshot`, and
`GetSessionForTurn` resolves the definition from it, not from `app_flow_nodes`.

So the natural place to put an accepted lesson is inside that snapshot, alongside
the node config it modifies. It is where `ExtractionSchema` lives (ADR-033 §3). It
would make the prompt for any turn exactly reconstructible from `flowVersionId`.
And it is wrong here, for a reason specific to what memory is.

A lesson's value is measured in how quickly it reaches sessions. Consider the
realistic case: a flow has run for three months, forty sessions are in flight at
any moment, and the owner accepts a lesson that stops the model asking a question
it already has the answer to. If lessons live in the snapshot, that acceptance
reaches nobody. It requires the author to publish a new version, and it applies
only to sessions started afterwards — the forty running sessions keep asking the
redundant question until each one ends. For a long-running flow, "afterwards" can
be weeks. The feature would be technically present and practically inert.

Worse, folding lessons into the snapshot conflates two things with genuinely
different lifecycles. A flow version is an authored artefact: a person changed the
graph and published it, and the version number means "this is what the author
wrote". A lesson is a governance decision *about* an existing flow, made in a
different act, by a possibly different person, and — critically — a decision an
author might make five times without ever touching the graph. Writing lessons into
snapshots means either publishing a version nobody authored, or mutating a
snapshot after publication. Both damage what a version means.

There is also a precedent pointing the other way. `globalInstructions` — the
operator-set, organisation-wide guidance in `BuildSystemPromptInput` — is already
resolved live at prompt-build time and is already not in any snapshot. Changing it
changes every session's next turn. Nobody has found that surprising, because it is
governance configuration rather than flow authoring, and that is exactly what a
lesson is.

## Decision

**1. Accepted lessons are resolved live at prompt-build time, keyed by
`(flowId, nodeId)`, and are not written into `app_flow_versions.snapshot`.**

`GetSessionForTurn` (or the turn assembly beside it) reads
`listAcceptedByFlow(flowId)` and passes the matching node's lessons into
`BuildSystemPromptInput.acceptedLessons`. The nodes and edges the runner walks
still come from the pinned snapshot, untouched. The graph stays frozen; the
guidance attached to a node does not.

**2. A lesson binds to a node id, and a node id that is gone means the lesson is
gone.**

Node ids are stable across versions for a node that persists, so a lesson accepted
against version 4 keeps applying at version 7. If the author deletes the node, the
lesson has nothing to attach to: the next distillation pass retires it
(ADR-057 §7), and it stops rendering immediately — a retired lesson is not
`accepted`, and only `accepted` renders.

A session pinned to an older version whose node still exists in that snapshot but
not in the live flow is the one asymmetric case: the session still walks that node,
and the lesson for it has been retired. The lesson stops applying. That is the
correct direction of failure — an author who deleted a step has withdrawn its
guidance, and continuing to inject guidance for a step the author removed would be
the surprise.

**3. Reconstructing a past prompt requires `flowVersionId` plus the accept
timestamps, and that is accepted.**

This is what the decision costs, stated plainly. A turn's prompt is no longer a
function of `flowVersionId` alone. To reconstruct what the model was told at a
given moment, a reader needs the pinned snapshot *and* the set of lessons accepted
before that moment.

Both halves are recorded: `acceptedAt` on the lesson, and the `core_audit_log`
entry for each transition (ADR-057 §7). Reconstruction is therefore possible and
auditable — it is a join, not an archaeology problem. What is lost is that it is no
longer a single-row lookup.

**4. Lessons render in the stable prompt region, not the per-turn region.**

The `<learned_guidance>` block sits after `<skills>` and before `<instructions>` —
above retrieved chunks, attached documents and the current-date block, which
ADR-016 places below precisely because they change every turn. A lesson set changes
only when someone accepts or retires one, which is rare, so it belongs above the
cache boundary.

Accepting a lesson mid-session therefore invalidates that session's prompt cache
once. This is the right trade: one cache miss, at the moment of a human decision,
against a per-turn cache miss on every turn forever.

## Consequences

- An accepted lesson takes effect on the next turn of every session on the flow,
  including sessions started months earlier under an older version. This is the
  point of the decision and its principal risk: acceptance is immediate and wide,
  so a bad acceptance is immediate and wide too. The accept gate and evidence
  receipts of ADR-057 are what stand in front of it; there is no staged rollout.
- The ADR-015 guarantee is narrowed, deliberately and explicitly, from "the whole
  prompt is stable" to "the *graph* is stable". Steps, edges, branch rules,
  templates and field sets remain pinned. Guidance attached to a step does not.
- Lessons need no snapshot migration, no version bump on acceptance, and no
  rewrite of `flowNodesFromSnapshot`. Publishing a new version neither carries
  lessons forward nor drops them, because they were never in the snapshot.
- The turn read gains one indexed query on `ai_flow_lessons (flow_id, node_id,
  status)`. It fans out with the existing parallel reads in `GetSessionForTurn`
  rather than serialising behind them.
- A flow version diff will not show why a step's behaviour changed between two
  sessions on the same version. The memory panel and audit log are where that
  question is answered, and a reader looking only at versions will not find it —
  which is a documentation obligation, not a defect.
