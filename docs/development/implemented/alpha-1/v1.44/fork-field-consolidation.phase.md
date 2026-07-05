# Phase — Fork-Sibling Field Consolidation in Flow Insights

- **Status**: Awaiting review
- **Target version**: 1.41.0  (bump: MINOR — new reporting behaviour, no schema change)
- **Depends on**: existing Flow Insights deep-dive (`computeFieldReport`), flow
  graph edges (`IFlowEdgeRepository`), exclusive branch routing in `run-turn`
- **Scope**: report-side only. No DB migration, no authoring UI, no change to how
  data is captured.

## 1. Problem

When a flow forks, the same real-world data is captured on more than one
mutually-exclusive branch. In the procurement example, `Request Intake` forks
into a **Standard Purchase** path and a **Procurement Approval** path that later
rejoin at `Save document`. Both paths capture *amount of purchase*; the flow may
also have two approval steps (`Manager Approval`, `Bl Approval`) that are, in
practice, the **same approval gate** on opposite branches.

Today the Flow Insights field report keys every column as `` `${nodeId}:${fieldKey}` ``
(`packages/domain/src/entities/analytics.ts:347`), so each branch produces its
**own column** even when the field means the same thing. An admin wanting to
report on "amount" or "approval outcome" as a single field has to read across
two columns and mentally merge them.

We want those columns to collapse into one — but only when it is provably safe,
and never for genuinely distinct steps (e.g. a later, separate Finance Sign-off
approval that happens to reuse the `outcome` field key).

## 2. Goals

- In the Flow Insights field report, collapse two columns into one **iff**
  (a) they share the same `fieldKey`, **and**
  (b) their owning nodes are **fork-siblings** — mutually unreachable in the flow
      graph, i.e. no directed path runs through both, so a single session can
      only ever populate one of them.
- A **UI toggle** ("Combine forked steps") to turn collapsing on/off, **on by
  default**. Reversible; persists like the existing view preferences.
- A later, structurally-distinct step that reuses the same field key (e.g. a
  third approval downstream of both branches) is **never** merged.
- Existing per-column filtering, visibility toggles, and numeric stats keep
  working against the collapsed column.

## 3. Non-goals

- No merging across branches when the field **keys differ** (e.g. one branch
  labels it "Amount" and the other "Estimated amount" → different derived keys).
  That requires aligning the template labels and is out of scope here.
- No authoring/classification UI, no `reportingKey`/group tag on nodes or fields,
  no template-tag syntax change.
- No DB schema change. No change to capture, projection, or `SessionStepOutput`.
- No change to `computeNodeBreakdown` or overview metrics.

## 4. Approach

The collapse is computed server-side (pure domain) but applied/visualised
client-side so the toggle never re-fetches:

1. **Plumb the graph into analytics.** `GetFlowDeepDive` already loads nodes,
   sessions, and step outputs; add `IFlowEdgeRepository.listByFlow` so the report
   has the flow's edges.
2. **Fork-sibling detection (pure helper).** A new dependency-free domain helper
   computes, from `FlowEdge[]`, which node pairs are **mutually unreachable**.
   Because routing is exclusive — a session holds a single `currentNodeId` and a
   fork requires a `branchChoice` to pick exactly one outgoing edge
   (`packages/application/src/use-cases/session/run-turn.ts:107`) — two
   mutually-unreachable nodes can never both be visited in one session. That is
   the exact, sufficient condition for a safe collapse.
3. **Annotate columns, don't drop them.** `computeFieldReport` keeps returning the
   full expanded column set, but tags each `FieldReportColumn` with an optional
   `collapseGroupId`. Columns sharing the same `fieldKey` whose nodes are all
   pairwise fork-siblings receive the same deterministic group id
   (`${fieldKey}::${[...nodeIds].sort().join("+")}`). Columns with no eligible
   sibling get no group id. Row `values` are unchanged (still keyed per raw
   `columnKey`).
4. **Collapse in the UI.** `FieldReportSection` gets a "Combine forked steps"
   toggle (default ON). When ON, columns sharing a `collapseGroupId` render as a
   single column (header = shared `label`; subtext = the contributing step names);
   each row's value is the coalesced non-empty value across the group's member
   `columnKey`s (exclusive routing ⇒ at most one is populated). When OFF, the
   table renders exactly as today.

This keeps the toggle purely presentational and reversible, needs zero authoring,
and distinguishes the "later standalone approval" case structurally: that node is
reachable from both branch approvals, so it is not a fork-sibling and gets no
shared group id.

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/analytics.ts` | add optional `collapseGroupId?: string` to `FieldReportColumn`; `computeFieldReport` gains an `edges` arg and assigns group ids via the new helper |
| domain | `packages/domain/src/entities/flow-graph.ts` (new) | pure `computeForkSiblingGroups(nodeIds, edges)` / reachability helper over `FlowEdge[]`; dependency-free, relative imports only |
| domain | `packages/domain/src/ports/flow-edge-repository.ts` | no change — `listByFlow` already exists |
| application | `packages/application/src/use-cases/analytics/get-flow-deep-dive.ts` | inject `IFlowEdgeRepository`; load edges for the selected flow; pass them into `computeFieldReport` |
| adapters | — | no change (`DrizzleFlowEdgeRepository` already implements the port) |
| web | `apps/web/src/lib/container.ts:465` | pass existing `flowEdges` into the `GetFlowDeepDive` constructor |
| web | `apps/web/src/components/admin/field-report-section.tsx` | add "Combine forked steps" toggle (default ON, persisted to `localStorage` like other view prefs); derive merged columns from `collapseGroupId`; coalesce row values; route filters/visibility/stats through the merged column |
| web | `apps/web/src/server/routers/analytics.ts` | no change — same query, richer column annotations |

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain — graph helper.** Write `flow-graph.test.ts` first:
   (a) linear chain → no fork-siblings; (b) simple fork that rejoins → the two
   branch nodes are siblings, the rejoin node is sibling to neither;
   (c) a node downstream of both branches is sibling to neither branch node;
   (d) cyclic edges → mutually reachable, never siblings (guard). Implement
   `computeForkSiblingGroups`.

2. **Domain — column annotation.** Extend `analytics.ts` tests: given step
   outputs on two fork-sibling nodes with the same `fieldKey`, both columns get
   the same `collapseGroupId`; same key on non-sibling nodes → distinct ids;
   different keys on siblings → distinct ids; narrative still skipped. Then add
   the `edges` param and group assignment to `computeFieldReport`. Keep the
   no-edges call path behaving as today (no group ids).

3. **Application — plumb edges.** Update `get-flow-deep-dive` test to assert edges
   are loaded for the selected flow and forwarded. Inject `IFlowEdgeRepository`,
   load via `listByFlow(selectedFlowId)`, pass to `computeFieldReport`.

4. **Web — container wiring.** Pass `flowEdges` into `new GetFlowDeepDive(...)`.

5. **Web — UI collapse + toggle.** "Combine forked steps" toggle defaulting ON,
   persisted alongside existing column/filter prefs. Render one column per
   `collapseGroupId` when ON (header = label, subtext = step names), value =
   first non-empty across group members; raw columns when OFF. Ensure
   `filterColumn`, visibility set, and `matchStats` operate on the merged column
   key when collapsing.

6. **E2E.** `apps/web/e2e/enhance-fork-field-consolidation.spec.ts`: a flow with a
   fork where both branches capture the same field; assert the insights table
   shows one combined column by default, and that toggling off splits it back
   into per-step columns. (Authored during build, not in this doc.)

7. **Version + validate.** Bump `VERSION` and root `package.json#version` to
   `1.41.0`. Run `./validate.sh`; fix all failures. Move this phase doc to
   `docs/development/implemented/v1.41/` with an implementation summary noting the
   covering e2e test.

## 7. Acceptance criteria

- [ ] Two fork-sibling steps capturing the same `fieldKey` render as **one**
      column in Flow Insights, with the toggle **on by default**.
- [ ] Toggling "Combine forked steps" off restores the per-step columns; state
      persists across reloads.
- [ ] A step reachable from both branches (e.g. a later standalone approval)
      reusing the same field key is **never** merged.
- [ ] The two approval steps' projected fields (`outcome`, `decided_at`,
      `decided_by`, `comment`) collapse into single columns when the approvals are
      fork-siblings.
- [ ] Per-column filtering, visibility, and numeric stats work against the merged
      column.
- [ ] `computeFieldReport` with no edges behaves byte-for-byte as today.
- [ ] Architecture boundaries intact: graph helper is pure domain
      (dependency-free); edges loaded in application via the existing port; Result
      pattern preserved.
- [ ] `VERSION` = `package.json#version` = `1.41.0`; `./validate.sh` passes.

## 8. Risks / open questions

- **Same-key requirement.** Consolidation only fires when both branches derive the
  same `fieldKey`. Divergent labels won't merge — call this out in the UI (e.g.
  the empty-state/help text) so authors know to align template labels.
- **Defensive double-capture.** Exclusive routing means at most one sibling is
  populated per session, but `OverrideBranch` could in theory let a single session
  visit both at different times. The coalesce rule then takes the first non-empty
  in column order; decide whether "latest by `created_at`" is worth threading
  through (would require per-value timestamps in the row model).
- **Merged-column identity for filters/URL state.** The merged view uses the
  `collapseGroupId` as its column key; ensure persisted filter/visibility keys
  remain stable when the toggle flips and degrade gracefully if a group id changes
  (e.g. after a flow edit alters the graph).
- **Cyclic flows.** If a flow contains loops, the reachability guard must treat
  mutually-reachable nodes as non-siblings (never collapse). Covered by test 1(d).
