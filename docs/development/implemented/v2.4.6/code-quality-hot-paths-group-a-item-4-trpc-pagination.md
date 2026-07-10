# v2.4.6 — Group A item 4: tRPC exposure of the keyset session-list contract

**Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition",
**Group A** (bounded reads + pagination contracts), item 4 — the UI-facing half.
**Bump**: PATCH (2.4.5 → 2.4.6). No schema change; two additive tRPC procedures,
a shared pure enrichment helper, and one UI migration to keyset pagination.

## Problem

v2.4.1 landed item 4's *server* contract — `ISessionRepository.listByUserPage` /
`listAllPage`, the `SessionListPage<T>` types, and the `ListSessionsPage` /
`ListAllSessionsPage` use cases (keyset on `(updated_at DESC, id DESC)`) — but
nothing exposed it. Every session-list UI still called the unbounded `list` /
`listAll` procedures, which return the whole set. The paginated use cases were
wired into the container yet had no caller, so the contract could not actually
be adopted.

## Change

- **tRPC** (`apps/web/src/server/routers/session.ts`):
  - `session.listPage` (authenticated) wraps `listSessionsPage`, returning the
    **same enriched rows** as `list`, one keyset page at a time with a
    `nextCursor`.
  - `session.listAllPage` (admin) wraps `listAllSessionsPage`, returning bare
    sessions + `nextCursor` (the admin view joins users/flows client-side).
  - `sessionListPageInputSchema` (`{ limit: 1..50 default 20, cursor?: string }`)
    is exported and unit-tested.
- **Shared enrichment**: the per-row shaping `session.list` computed inline
  (step index/total, completed-step count, current confidence, last message) is
  extracted to a **pure** `buildSessionListEntry(session, graph, summary)` plus a
  shared `enrichSessions(container, sessions)` batch helper. `list` and
  `listPage` now produce identical rows through the same code, so a future
  full-list → paginated swap is drop-in.
- **UI** (`admin/sessions/_content.tsx` + `page.tsx`): the admin sessions table
  migrates from `listAll.useQuery()` to `listAllPage.useInfiniteQuery({}, {
  getNextPageParam })`, flattening `data.pages`, with a "Load more" button gated
  on `hasNextPage`. The server prefetch switches to `prefetchInfinite`.

## Tests

- `session.test.ts` (new): `buildSessionListEntry` — null stepInfo when the flow
  graph is missing/empty; 1-based current index; current-node excluded from the
  completed count; below-threshold steps excluded; a `complete` session reports
  all steps done with zero current confidence. `sessionListPageInputSchema` —
  limit defaults to 20, accepts null/string cursor, rejects a limit outside
  1..50.
- Browser-verified against seeded data: the admin table renders 20 rows through
  the infinite query, **Load more** appends to 23 with the button then
  disappearing, and all 23 View links are unique — no duplicates or gaps across
  the cursor boundary (the adapter's strict `<` predicate is correct).

## Deliberately deferred

- **Message-list pagination endpoint**: needs a *new* keyset method on
  `ISessionMessageRepository` (seq-based) — that is fresh contract work, a
  separate vertical like v2.4.1 was for sessions, not mere tRPC exposure.
- **Chats page + sidebar migration**: both filter Active/Completed/All
  **client-side** over the full session set. Naive keyset paging would break
  those tabs; doing it right needs a status-filter parameter added to the
  keyset contract. Out of scope for "expose the existing v2.4.1 contract."
- `session.list` / `session.listAll` are retained as the additive full-list
  tier (still consumed by chats + sidebar; the admin full-list is kept for
  symmetry) — consistent with the phase's additive-migration philosophy
  ("the existing full-list methods stay").

## Notes

Group A item 4 is now half-landed end-to-end: session-list pagination is
exposed and proven in a real UI. The two remaining pieces above are the honest
next steps, each needing its own contract extension rather than another
exposure-only slice.
