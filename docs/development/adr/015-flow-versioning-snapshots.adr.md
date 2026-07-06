# ADR-015 — Flow Versioning via Immutable Snapshots

> **Numbering note**: two ADRs share the number 015. This one — *Flow Versioning
> via Immutable Snapshots* — is the ADR-015 the code cites (publish/restore flow
> versions, pinned session snapshots; e.g.
> `use-cases/flow/publish-flow-version.ts`, `entities/flow-version.ts`). The
> other is *Step-Level AI Overrides*. Deliberately not renumbered — code comments
> cite these numbers.

- **Status**: Proposed (Phase 6+; scoped by `flow-versioning.prd.md`)
- **Date**: 2026-05-31

## Context

`flow-versioning.prd.md` adds history and rollback to flows, which are mutable
in place today with no record of prior state. We must choose how a "version" is
represented and stored. Three models were considered:

- **A — Immutable snapshot on publish.** Each publish writes a complete, frozen
  copy of the flow definition (`flow` + `nodes` + `edges` + configs) as one row.
- **B — Full version branching.** Flows carry `version_number` + `parent_flow_id`;
  versions form a tree; sessions pin to a version.
- **C — Field-level change-log.** Record diffs (who/what/when) to a changes
  table; reconstruct state by replaying diffs.

Wayfinder's flow definition is already a small, self-contained set of `app_*`
rows with `jsonb` node config (ADR-006), and the product need is "see what it
was, roll back, and keep a running chat stable" — not concurrent divergent
development. Two further requirements shape the model: (1) editing a flow must
not disturb the published definition that chats run, so edits accumulate in a
**draft** version that is promoted on publish; and (2) a chat must run a single
fixed version from start to finish, so sessions **pin** to the version that was
latest-published when they began.

## Decision

Adopt **Option A — immutable snapshot on publish.**

### Snapshot shape

A version stores a self-contained `FlowSnapshot` as `jsonb`:

```ts
export interface FlowSnapshot {
  flow: FlowSnapshotMeta;   // name, description, icon, expertRole, contextDocs, ...
  nodes: FlowNode[];        // full config per node
  edges: FlowEdge[];
}
```

Because the snapshot is complete and frozen once published, a version survives
any later edit or deletion of the live rows. No joins to reconstruct history; no
diff replay.

### Version lifecycle: draft → published

A version carries a `status` of `draft` or `published`. Editing a flow opens a
single `draft` version (seeded from the latest published snapshot, or empty for a
never-published flow) and updates that draft's snapshot in place as the owner
works. The live `app_flow_*` rows remain the working copy the draft reflects.
**Publishing promotes the open draft to `published`**, stamping `published_by`
and `published_at`. A partial unique index on `(flow_id) WHERE status = 'draft'`
guarantees at most one open draft per flow, so editing never multiplies rows.
This keeps the published definition — the one chats run — untouched until the
owner deliberately publishes.

### Table

`app_flow_versions` (id, flow_id, version_number, status, snapshot jsonb,
change_summary, published_by_user_id, published_at, created_at, updated_at) with
a unique index on `(flow_id, version_number)` and a partial unique index on
`(flow_id) WHERE status = 'draft'`. The next number is allocated and inserted in
the **same transaction** as the publish so concurrent publishes cannot collide.
`published_by_user_id` and `published_at` are nullable until promotion.

### Session-version pinning

`app_sessions` gains `flow_version_id` (FK → `app_flow_versions`). When a chat
starts it resolves the flow's latest `published` version (highest
`version_number`) and stores that id, within the session-create transaction so a
concurrent publish cannot leave the pin ambiguous. The runner reads the pinned
snapshot, **not** the live `app_flow_*` rows, so a chat runs one fixed version
from start to finish regardless of edits, publishes, or restores happening in
parallel. The trade-off is intentional: stability for the life of a chat over
always running the newest version. Moving a live chat onto a newer version is a
deferred enhancement, not a v1 capability.

### Restore semantics

Restore is **non-destructive and forward-only**: applying version N rewrites the
live `app_flows` / `app_flow_nodes` / `app_flow_edges` to match the snapshot
**and** creates a *new* published version (N+1) whose summary records "restored
from version N". No snapshot row is ever mutated or deleted. History therefore
always moves forward, even for rollbacks. Chats already in progress are
unaffected — they stay pinned to their own version — so a restore only changes
what *new* chats will run.

Restore **preserves the original node `id`s** captured in the snapshot rather
than regenerating them, so any `current_node_id` reference held by a session
still resolves after a restore.

### Back-fill

A migration inserts a `version_number = 1` snapshot for every existing
`status='published'` flow, so history is complete from day one. Draft-only flows
get no version until their first publish.

### Why not branching (B)

Branching solves concurrent divergent flow development and per-session version
pinning — neither is a v1 need. It adds a version tree, parent pointers, and
merge questions that the product does not require yet. Snapshots do **not**
preclude branching later; a `parent_version_id` column could be added if the
need appears.

### Why not change-log (C)

Field-level diffs are the most storage-efficient but the most complex to read,
restore, and reason about (replay ordering, partial-apply failures). The
existing `core_audit_log` already captures *that* a flow changed and by whom;
duplicating a full structured diff store is not worth it when whole-snapshot
restore is the actual requirement.

## Consequences

**Positive**

- Trivial, reliable restore: load a snapshot, write it back. No replay.
- A version is fully self-contained and immutable — strong audit guarantees.
- Composes directly from existing `app_*` shapes; no schema reshaping.
- Does not foreclose branching or session-pinning as future enhancements.

**Negative**

- Each publish duplicates the full definition as `jsonb`; storage grows with
  publish count. Acceptable at expected flow sizes; a retention/pruning policy
  is deferred (PRD §11).
- A long-lived chat can finish on an old version after several newer ones have
  been published, because sessions are pinned and v1 has no mid-session upgrade.
  This is the intended behaviour (stability over currency); an upgrade action is
  a deferred enhancement.
- The runner must read the pinned snapshot rather than the live `app_flow_*`
  rows, adding a snapshot-resolution step to session execution.

## Open questions

- **Mid-session upgrade** — should a long-running chat be offered a move onto a
  newer version? Enabled by this model; deferred to a follow-up phase (PRD §11).
- **Retention** — cap the number of retained snapshots per flow, or keep all?
  Defer until storage is measured.
