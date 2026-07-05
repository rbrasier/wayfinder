# Phase — Code Quality: Hot Paths, Boundaries, and Decomposition

- **Status**: Awaiting review (`/doc-review`)
- **Date**: 2026-07-05
- **Target version**: staged; each group ships as its own sub-phase and bumps
  independently —
  - Group A (hot-path data access): **PATCH** per slice (no schema change if
    query-side; **MINOR** if the denormalised `last_message` column is chosen)
  - Group B (streaming inside the `ILanguageModel` port): **MINOR**
  - Group C (unit-of-work port): **MINOR**
  - Group D (frontend decomposition): **PATCH** per slice
  - Group E (boundary tightening): **PATCH**
  - Group F (in-process rate limiting): **MINOR**
- **Depends on / relates to**:
  - [`scaling-new-infrastructure.phase.md`](./scaling-new-infrastructure.phase.md) —
    everything requiring a new service (Redis cache promotion, cluster-wide
    LLM governor budget, distributed rate limiting) lives **there**, not here.
    This phase is deliberately code-only against the current stack.
  - `implemented/v1.58.0/scaling-current-stack.phase.md` — the scaling-walls
    program this phase extends; several items below close gaps that program
    left open (bounded prompt context but unbounded DB reads).
  - ADR-001 (hexagonal architecture), ADR-026 (usage governance — decorator
    order), ADR-021 (RBAC).

---

## 1. Problem

A code-quality and architecture review (2026-07-05) found the codebase in
strong shape structurally, with the remaining gaps concentrated in five
areas that only hurt under data growth and change velocity:

1. **Unbounded reads and N+1 on hot paths.** The prompt window is bounded
   (scaling wall #1) but the underlying DB reads are not: several paths load
   a session's **entire** message history when only the tail is used, and
   `session.list` does it once per session, per request.
2. **The chat stream route bypasses the `ILanguageModel` port.** Quota,
   usage tracking, and governor wrapping — delivered as port decorators
   (ADR-026) — are re-plumbed by hand in the route, and ~1,400 lines of turn
   policy live in the HTTP layer.
3. **Multi-write use cases are not atomic.** The application layer has no
   transaction seam, so e.g. `persistAssistantTurn` writes the assistant
   message and the session advance as separate statements.
4. **A handful of very large files** concentrate change risk (a 2,183-line
   client component is the worst).
5. **Small boundary erosions**: routes reaching into `container.repos.*`,
   a router importing from a route directory, duplicated cookie parsing,
   an unvalidated request body on the stream route.

## 2. Goals

- Hot-path DB reads are bounded regardless of session age; list endpoints
  have pagination contracts before UIs assume full lists.
- Streaming model calls go through the `ILanguageModel` port so every
  decorator (quota, usage, Langfuse, governor) applies uniformly.
- Multi-write use cases run atomically behind a domain `UnitOfWork` port.
- No non-test source file at or above 800 lines (enforced by `validate.sh`;
  the legacy allowlist shrinks to empty as Group D lands).
- Routes consume use cases, not repositories.
- Auth and chat endpoints are rate-limited (per-instance; the shared-store
  promotion is the infrastructure phase's job).

## 3. Non-goals

- Anything needing a new service: Redis-backed caches, a distributed
  governor budget, a job queue, shared rate-limit state — see
  `scaling-new-infrastructure.phase.md`.
- New product features or UI redesign; Group D is a mechanical decomposition
  with byte-for-byte behaviour.
- Renumbering published ADRs (Group E annotates the duplicates instead —
  code comments reference ADR numbers, so renaming is riskier than the smell).

---

## 4. The enhancements

### Group A — Hot-path data access (do first)

> **Progress**: items 1 and 2 landed in **v2.0.2** (query-side fix; summary at
> `implemented/v2.0.2/code-quality-hot-paths-group-a-slice-1.md`). Items 3 and 4
> remain.

1. **`session.list` N+1** (`apps/web/src/server/routers/session.ts`): today
   it loads full flow graphs and the **entire message history of every
   session** to derive `lastMessage` and per-step best confidence. Replace
   with SQL-side aggregation: one query returning, per session, the latest
   assistant message and `max(confidence) group by step_node_id` (lateral
   join or window function) behind a new `ISessionMessageRepository` (or
   analytics-repository) method. Alternative if measurement favours it:
   denormalise `last_message_seq` onto `app_sessions` (MINOR, additive
   column). Decide at build time; default to the query-side fix.
2. **`RunTurn.persistUserMessage`** calls `listBySession` (all rows) to
   inspect only the last message — switch to the existing
   `latestBySession(sessionId, 1)`.
3. **Turn read path**: `getSession` loads the whole transcript each turn
   while the route uses only the last `CONTEXT_WINDOW_MESSAGES` (20). Give
   `GetSession` (or a leaner turn-scoped variant) a bounded read via
   `latestBySession`, keeping the full read only where the UI genuinely
   needs the whole transcript (and see item 4 for that case too).
4. **Cursor pagination contracts** on message and session list endpoints
   (tRPC `session.list`, message fetches, admin `listAllSessions`).
   Keyset pagination on `(created_at, id)` / `seq`; the chat UI already
   works off a tail slice so this is contract work, not redesign.

### Group B — Streaming inside the `ILanguageModel` port

The stream route acknowledges in comments that it "calls the SDK directly,
outside the ILanguageModel port", which forced manual re-plumbing of quota,
usage recording, and governor wrapping (ADR-026 decorators).

5. Extend `ILanguageModel` with a streaming method (`streamObject` /
   `streamText` shape mirroring the existing non-streaming ports), implement
   it in `LanguageModelAdapter`, and make `withUsageTracking`,
   `withQuotaEnforcement`, and `withOptionalLangfuse` cover it. Delete the
   route's hand-rolled equivalents.
6. Pull turn orchestration (gate holds, readiness evaluation, branch choice,
   advance side effects) out of
   `apps/web/src/app/api/chat/[sessionId]/stream/{route.ts,turn-helpers.ts}`
   into an application-layer use case (e.g. `ExecuteTurn`) that takes ports
   plus a stream-writer abstraction. The route shrinks to: auth, lease
   claim/release, HTTP ↔ use case translation. The already-extracted pure
   gate modules (`branch-gate`, `readiness-gate`, `gate-holds`) move with it.

### Group C — Unit-of-work port

7. Add a `UnitOfWork` (transaction) port to `packages/domain` — e.g.
   `withTransaction<T>(work: (repos: TransactionalRepos) => Promise<Result<T>>): Promise<Result<T>>`
   — implemented in adapters over `db.transaction`, exposing transactional
   variants of the repositories a use case needs. Keeps the "application
   sees no ORM" rule intact.
8. Wrap the multi-write use cases: `persistAssistantTurn` (assistant message
   + session advance/complete) first, then `DecideApproval`,
   `ApplyAutoNodeResult`, and any other use case doing more than one write.

### Group D — Frontend and file decomposition

Works in tandem with the new `validate.sh` file-size ratchet (warn ≥ 700,
fail ≥ 800, legacy allowlist below). Exit criterion for each slice: the file
drops under 700 lines and leaves the allowlist; the phase is done when the
allowlist is empty.

9. `apps/web/src/app/(admin)/admin/settings/page.tsx` (2,183) — split per
   settings section (each already owns its own tRPC calls); extract shared
   hooks/components under `components/settings/`.
10. `apps/web/src/components/canvas/node-config-modal.tsx` (1,135) — split
    per node type / tab.
11. `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` (944) and
    `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx` (934) — extract
    shared flow-config sections; these two overlap heavily.
12. `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (858) —
    largely dissolved by Group B item 6; whatever remains splits by concern.
13. `apps/web/src/components/admin/field-report-section.tsx` (732) —
    warn-level only; split opportunistically when next touched.

### Group E — Boundary tightening (small, independent slices)

14. **Narrow the container surface handed to routes**: expose use cases and
    a small set of named services; stop `container.repos.*` reach-through
    (the stream route reads `repos.sessionUploads`, `repos.users`,
    `repos.sessionMessages` directly). Migrate existing reach-throughs
    behind use cases as Group B touches them.
15. **Dedupe `getSessionToken`** (identical cookie parsing in
    `apps/web/src/server/trpc.ts` and the stream route) into one helper.
16. **Fix inverted layering**: `server/routers/session.ts` imports
    `confirmStep` from the `app/api/.../stream/` route directory — move it
    to the application layer (naturally falls out of Group B) or a shared
    server lib.
17. **Zod-validate the stream route body** (`body.messages` is currently a
    type cast) using a schema from `@rbrasier/shared`.
18. **ADR numbering duplicates** (two 015s, two 026s): annotate each
    duplicate pair with a disambiguating note at the top of the file (e.g.
    "also numbered 026; cited in code as ADR-026 §6 = usage-governance").
    Do not renumber — code comments cite these numbers.

### Group F — In-process rate limiting

19. Rate-limit the auth endpoints and the chat stream POST with a
    per-instance token bucket behind a small `IRateLimiter` port (keyed by
    user id / IP). No new service: in-memory, same pattern as `TtlCache`.
    The port is the seam the infrastructure phase promotes to a shared
    store when instance count > 1.

---

## 5. Suggested sequencing

A (1–4) → C (7–8) → B (5–6) → E (14–18, some fall out of B) → F (19), with
D (9–13) interleaved as independent slices any time. A, C, D, E, F have no
dependencies on each other; B is easier after C exists (the extracted
`ExecuteTurn` use case can be transactional from day one).

---

## 6. Acceptance criteria

- No turn or list request reads an unbounded number of message rows;
  `session.list` issues O(1) queries regardless of session count/age
  (verified by the load scenarios in `load/scenarios/`).
- Grepping the stream route for `generateObject`/`streamObject` SDK calls
  finds none — all model calls traverse the decorated port.
- Killing the process between the assistant-message write and the session
  advance can no longer leave a half-applied turn (transaction covers both).
- `validate.sh` file-size check passes with an **empty** legacy allowlist.
- Auth + chat endpoints return 429 under the configured burst.
- `./validate.sh` passes at every slice; versioning rules honoured per
  implementing sub-phase.

---

## 7. Risks and open questions

- **Group B is the riskiest change** — it rewrites the most-exercised path.
  Mitigate by landing it behind the existing e2e chat suite plus a dedicated
  `enhance-stream-port.spec.ts`, and by moving the pure gate modules
  verbatim (they carry their own tests).
- **Group A item 1**: query-side vs denormalised column — decide with
  `EXPLAIN ANALYZE` on a seeded dataset (see `load/`), not taste.
- **Pagination contracts** (item 4) touch client code; ship server support
  first with a default page size large enough to be behaviour-neutral, then
  tighten.

---

## Provenance

Code-quality and architecture review, 2026-07-05 (session: code-quality
/ architecture review). Companion service-dependent items were folded into
`scaling-new-infrastructure.phase.md` in the same change.
