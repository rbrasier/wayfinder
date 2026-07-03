# Scaling Within the Current Stack

Enhancements that improve performance under concurrent usage **without adding
any new service**: code and schema changes only, running on the existing
stack (Node processes, single Postgres with pgvector, MinIO). This is where
scaling work starts — most of the headroom to ~500 concurrent users comes
from making each request cheaper and making concurrent writes correct, not
from more hardware.

Companion guide: [`scaling-new-infrastructure.md`](./scaling-new-infrastructure.md)
covers the enhancements that *do* require new services (connection pooler,
Redis, job-queue backend, read replica, cloud platform) — most of which
become mandatory the moment more than one app instance runs.

Both guides consolidate two former phase docs (*Scaling to Concurrent Load*,
2026-06-22, and *Concurrency Efficiency, Collaborative-Session
Re-architecture & Cloud Readiness*, 2026-07-01). Implementation of any group
below should go through the normal skill workflow (`/new-feature` →
`/doc-review` → `/build`) with a phase doc scoped to that group; this guide
is the reference, not the build spec.

---

## Target load

Size for **~500 concurrent active users** (≈5000 registered accounts at ~10%
concurrency), each running document-producing AI workflows. 5000 *registered*
accounts is not itself a scaling problem; 5000 *concurrent* sessions would be
a much larger effort and is explicitly deferred.

**Out of scope**: multi-region/active-active, multi-tenant sharding,
sub-second scheduling, CRDT co-editing of message text or documents, and
WebSockets (see group C for why SSE instead).

---

## Baseline and existing leverage

A pnpm/Turbo monorepo: `apps/web` (Next.js 15, tRPC v11, streaming chat via
the Vercel AI SDK), `apps/api` (Express: health, webhooks, scheduler tick
loop), hexagonal packages behind domain ports with the Result pattern.
Backing services: a single Postgres (Drizzle, pgvector), MinIO/S3 object
storage, a Postgres-polling scheduler.

Already in place — leverage, don't rebuild:

- **Hexagonal architecture** — swapping a Postgres adapter or adding a cache
  adapter is a local change behind a port.
- **Hot-path indexes**: `ai_usage_events(user_id, created_at)`,
  `app_session_schedules(status, next_fire_at)`, session/message/approval
  indexes, and a pgvector HNSW index on `kb_document_chunks.embedding`.
- **Multi-worker-ready scheduler** — ADR-019 claims rows with
  `FOR UPDATE SKIP LOCKED`; running N workers needs no schema change.
- **Prompt caching + shared compiled graphs** — ADR-007 caches the compiled
  LangGraph per `(flowId, flowVersionHash)` and uses Anthropic prompt
  caching, cutting per-turn cost ~90% on repeated flows.
- **Per-user spend caps** — ADR-026 enforces budgets on the hot path.
- **Delivered in v1.49.0 (former P0)**: env-driven DB pool
  (`DATABASE_POOL_MAX`), short-TTL in-process session/permission cache
  (`AUTH_CACHE_TTL_MS`, `AUTH_CACHE_MAX_ENTRIES`) fronting `resolveSession`
  and effective permissions, and a statelessness audit confirming N replicas
  behind a load balancer are safe once the shared-cache promotion happens
  (see the new-infrastructure guide).

---

## Capacity model (back-of-envelope)

A single chat turn touches ~4–6 short DB operations (session lookup,
permission resolution, budget check, optional RAG lookup, message/usage
writes) plus multiple LLM calls that each run for seconds and hold a
streaming response open. The DB ops are fast; the LLM calls dominate
wall-clock.

**Connections**: size `pool_per_instance × instance_count` to stay safely
below Postgres `max_connections` (default 100), reserving headroom for
migrations, the scheduler, and admin tooling. For ~500 concurrent across ~4
web instances, a per-instance pool of ~15–20 is a sane start — behind a
transaction-mode pooler (new-infrastructure guide) once instance count grows.
Validate with load tests rather than guessing.

**LLM throughput**: one conversational turn can issue up to **six** model
calls (main structured stream, branch choice, readiness evaluation, gap
follow-up stream, next-step initial message, title generation) — seven with
the MCP tool pre-pass. 500 concurrent turns can mean ~3000 in-flight provider
calls, exceeding provider TPM/RPM limits long before the DB hurts. Prompt
caching reduces token volume but not request count.

---

## Where it breaks — the walls

All twelve walls, for context. Walls marked ↗ are closed by the
new-infrastructure guide; everything else is closed here.

| # | Wall | Evidence | Effect at ~500 concurrent |
| - | --- | --- | --- |
| 1 | Unbounded message-history loads | `DrizzleSessionMessageRepository.listBySession` has no limit/cursor; runs ≥4× per turn (route entry, dedupe guard, milestone lookup, gathered-context rebuild) and backs every 3 s poll | Read amplification dominates DB load; a 200-message session with 3 participants costs ~4 full reads per turn + ~1 per participant per 3 s, forever |
| 2 | Polling as transport | `session.get` every 3 s, `typingUsers` every 2 s, typing heartbeat writes every ~2 s per open window | ≈165 full-history reads/s + 250 typing reads/s **at idle** with 500 open windows — an order of magnitude more DB work than the turns themselves; 2–3 s collaboration latency floor |
| 3 | No server-side turn serialisation | "Lock Send" is client-only (`isLoading` local to each window); `DrizzleSessionRepository.update` is last-writer-wins | Two simultaneous sends both run: double message, double LLM spend, double advance; `pendingExecutions` (JSON blob) races with webhook/MCP writers |
| 4 | Serial awaits in the stream-route prologue | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` awaits org name → global instructions → uploads → upload config → user profile → RAG sequentially | ~6 round-trips of pure latency on every turn while a pool connection is held |
| 5 | Unbounded LLM concurrency | No limiter or budget around any of the per-turn model calls | Provider rate limits and per-stream memory both bite (see capacity model) |
| 6 | Participant hydration N+1 | tRPC `session.get` issues one `users.findById` per participant per poll | Multiplies wall #2 |
| 7 ↗ | Fire-and-forget background work is process-bound | `void generateDocument(...)`, `void generateTitle(...)`, notifier fire-and-forgets run detached in the web process | A deploy/restart mid-generation silently loses work — closed by the job queue (new-infrastructure guide; pg-boss is the no-new-service fallback) |
| 8 | Single scheduler worker, batch 50 / 60 s tick | `scheduler-worker.ts`, `fire-due-schedules.ts` | Backlogs when many schedules come due together (drains ≤ ~50/min) |
| 9 | Unbounded-growth tables | `ai_usage_events`, `app_session_messages`, `core_audit_log`, `app_error_log`, `app_notification_log` | Index/table bloat over months; slower hot-path queries |
| 10 | In-memory upload buffering | uploads route does `Buffer.from(await file.arrayBuffer())` + sync extraction | Concurrent large uploads spike memory and block the request path |
| 11 | Link-as-credential collaboration | Session UUID grants write forever; `?shared=true` read-only is client-side cosmetic | No participant record, revocation, or join audit |
| 12 | MCP tool pre-pass is serial and unbudgeted *(skills/MCP branch)* | `runMcpToolPrepass` opens SSE clients per server sequentially, re-fetches tool listings per turn, no deadline | Seconds of dead air before first token; a slow MCP server stalls the turn indefinitely |

---

## The enhancements

Groups are ordered so each removes the riskiest remaining failure mode first.
**Group A is deliberately scoped as a standalone first phase**: pure code
fixes — no schema change, no migration, no new service — so it can be built
and shipped on its own (MINOR bump) before any of the schema-touching work
in groups B–D is picked up.

### Group A — Pure code fixes (standalone first phase; no schema change)

Make each request cheaper so the same hardware carries more concurrent
users, and remove the two request-path resource spikes. Everything here is
code-only and independently shippable as one phase.

1. **Message pagination + single load per turn** (wall #1). Add
   `latestBySession(sessionId, limit)` and
   `listSince(sessionId, afterCreatedAt | afterSeq)` to
   `ISessionMessageRepository`. The dedupe guard needs only the last row;
   thread one loaded list through the turn (make the freshly-persisted rows
   an explicit parameter to `applyAdvanceSideEffects`) instead of re-reading.
   Have the server honour the same 20-message context window from the DB that
   the client already applies — this also removes the client-supplied
   transcript as a trusted input.
2. **Parallelise the stream-route prologue** (wall #4). One `Promise.all`
   for the independent reads; front the near-static admin settings (org name,
   global instructions, upload config) with the existing `TtlCache`
   (30–60 s TTL) — reuse the auth-cache pattern, don't invent a second cache
   shape.
3. **Batch participant hydration** (wall #6). `IUserRepository.findByIds`
   (single `IN` query) or fold display names into the message query. Removed
   entirely once participants become rows (group B).
4. **Cache immutable flow-version snapshots** per `flowVersionId` in
   `TtlCache`, and split the poll payload into "definition" (cache-forever
   per pinned version: nodes/edges/snapshot) vs "state" (session row +
   message delta) so polls only carry state.
5. **LLM concurrency limiter + backoff** (wall #5). Per-instance limiter and
   retry-with-backoff around all provider calls in the stream route; honour
   provider rate-limit headers. Every per-turn call — including the MCP
   pre-pass — counts against the limiter and ADR-026 quota enforcement.
6. **Harden the MCP/skills path** (wall #12, once that branch lands).
   Connect to MCP servers with `Promise.all`; wrap the pre-pass in a
   configurable deadline (~10 s default) that fails open (skip tools, run
   the turn); cache `listTools` per server id (60 s+, invalidated on admin
   edits); cache skill bodies by skill-id set. Verify skill text sits inside
   the Anthropic prompt-cache prefix in `buildSystemPrompt`.
7. **Scheduler tuning and parallelism** (wall #8). Make batch size and tick
   interval configurable; run multiple `SchedulerWorker` instances — the
   `FOR UPDATE SKIP LOCKED` claim already supports it (ADR-019).
8. **Stream uploads** (wall #10). Stream straight to MinIO/S3 instead of
   buffering whole files in memory. Moving text extraction off the request
   path depends on the job queue (new-infrastructure guide) — the streaming
   half stands alone and removes the memory spike now.

### Group B — Correctness under concurrency (schema: columns + one table)

The single most important correctness work across both guides.

9. **Server-side turn lease** (wall #3). Add `active_turn_id`,
   `active_turn_claimed_by`, `active_turn_claimed_at` to `app_sessions`.
   Claiming is one atomic conditional update (no advisory locks — works
   through transaction poolers):

   ```sql
   UPDATE app_sessions
   SET active_turn_id = $turnId, active_turn_claimed_by = $userId,
       active_turn_claimed_at = now()
   WHERE id = $sessionId
     AND (active_turn_id IS NULL OR active_turn_claimed_at < now() - interval '120 seconds')
   RETURNING id;
   ```

   Zero rows → someone else holds the turn → the stream route returns **409**
   with the holder's name ("Alex's turn is in progress"). The staleness
   window is the crash-recovery lease; make it runtime config and have long
   turns re-stamp `active_turn_claimed_at` per stream chunk as a heartbeat,
   since doc-gen-heavy turns can exceed 120 s. Release in the same write that
   persists the assistant turn, or in the error path. Expose as
   `ISessionRepository.claimTurn / releaseTurn` returning `Result` with a
   `CONFLICT` domain error. `persistUserMessage` happens **after** a
   successful claim, closing the double-message window.
10. **Optimistic versioning for all other session writes**. Add
   `version integer not null default 1` to `app_sessions`; every update
   becomes `… WHERE id = $id AND version = $expected` with zero rows mapped
   to `CONFLICT`. Callers (advance, confirm-step, override-branch, approvals,
   auto-node/n8n/MCP callbacks) reload-and-retry once or surface the
   conflict. This is the backstop for the non-chat writers the lease doesn't
   cover — in particular the `pendingExecutions` JSON blob, which webhooks
   and MCP confirmation parking both rewrite wholesale.
11. **Participants as rows, not URL knowledge** (wall #11). New table
   `app_session_participants` (`id`, `session_id` FK, `user_id` FK, `role`
   `owner|collaborator|viewer`, `joined_at`, `invited_by`, timestamps;
   unique on session+user). Joining stays link-based — opening the
   collaborate link **auto-enrols** the authenticated user as `collaborator`,
   audited via `LogAuditEvent` — but the stream route now authorises against
   the table (owner/collaborator send; viewer read-only; non-participant may
   auto-enrol via the link, else 403), so revocation actually works.
   `?shared=true` stops being the read-only signal; the server-computed role
   is. Kills the participant N+1.

   *Open product call*: should any authenticated user with the link become a
   collaborator, or only users the flow is visible to? Recommendation:
   honour flow visibility.

### Group C — Real-time transport (event bus + SSE; schema: `seq`)

Replaces polling (wall #2) — the dominant steady-state load — and closes the
"collaborators can't watch the reply stream" gap, **using only Postgres**.
The v1.17.0 *product* semantics stay (append-only messages, one shared
conversation, one AI turn at a time, typing dots); only the machinery
changes.

12. **`ISessionEventBus` port, backed by Postgres `LISTEN/NOTIFY`**:

    ```ts
    interface ISessionEventBus {
      publish(sessionId: string, event: SessionEvent): Promise<Result<void>>;
      subscribe(sessionId: string, handler: (event: SessionEvent) => void): Promise<Result<Unsubscribe>>;
    }
    ```

    The `LISTEN/NOTIFY` adapter uses the existing `postgres.js` driver — one
    LISTEN connection per process, fanning out in-process to that instance's
    SSE subscribers. Publish **notifications, not data** (`{type, sessionId,
    seq}`, under the 8 KB NOTIFY limit); the SSE handler fetches the delta
    via `listSince`. Multi-instance correct from day one because publishes
    traverse the bus, never process memory. A Redis pub/sub adapter can later
    drop in behind the same port (new-infrastructure guide) — the port is the
    seam that makes that swap local.
13. **SSE fan-out, not WebSockets.** Data flow is one-directional — sends
    already go through the existing POST (which must stay HTTP for the AI
    stream anyway). SSE is a plain streaming `GET` route handler (the chat
    stream already holds responses open the same way), needs no protocol
    upgrade or sticky sessions, passes every proxy the chat stream already
    passes, and `EventSource` gives auto-reconnect with `Last-Event-ID` for
    free. Event vocabulary: `turn.claimed`/`turn.released` (drives every
    window's Send-disabled state truthfully), `message.created` (`{seq}` →
    client fetches delta), `turn.delta` (collaborators watch the AI reply
    stream live), `typing` (ephemeral, never persisted), `session.updated`
    (`{seq}` → refetch state, not definition). Add a monotonic `seq` per
    session on `app_session_messages` so reconnects replay
    `listSince(lastEventId)` losslessly.
14. **Delete the polls; retire `app_session_typing`.** The 2 s/3 s polls and
    DB typing heartbeats go away; presence derives from live bus
    subscriptions. Keep a *slow* poll (15–30 s) as a degraded fallback using
    the same `listSince` delta — never the full payload. Client:
    `_content.tsx` swaps its two `refetchInterval` loops for one
    `EventSource`; `useChat` keeps handling the sender's own stream as today.

    *Deliberately unchanged*: append-only messages, no CRDTs (ADR-006), one
    AI turn at a time (now enforced), the agent stays ignorant of which human
    sent a message, read-only share links become `viewer` enrolments.

### Group D — Data growth and measurement

15. **Retention/archival for unbounded tables** (wall #9). Archival or
    partitioning for `ai_usage_events`, `app_session_messages`,
    `core_audit_log`, `app_error_log`, `app_notification_log`. Plain
    Postgres work.
16. **Load testing + SLOs.** Add a k6/Artillery suite (dev tooling, not a
    runtime service), define SLOs (p95 turn latency, error rate at 500
    concurrent), and run it before and after each group so sizing is
    measured, not guessed. Stand this up **early** — it gates every group's
    exit in both guides.

---

## Acceptance criteria per group

- **A** — a turn on a 500-message session performs ≤ 1 full message read
  (verified via query logging); stream-route time-to-first-token improves
  measurably vs baseline; the MCP pre-pass never exceeds its deadline under
  fault injection; scheduler drains a synthetic backlog at the configured
  parallelism; a large concurrent upload no longer spikes process memory.
- **B** — two simultaneous sends: exactly one runs, the other gets 409 with
  holder attribution; kill -9 mid-turn frees the session within the lease
  window; a stale-version update returns `CONFLICT`, never silently
  overwrites; a revoked collaborator's next send is 403; every join/revoke is
  audited.
- **C** — with two windows on one session: messages appear in the other
  window in < 500 ms (LAN); the AI reply *streams* in the collaborator's
  window; typing dots work with zero DB rows; killing and reconnecting the
  SSE connection replays missed messages via `Last-Event-ID`; steady-state DB
  queries per idle open window drop to ~0 (vs ~0.8/s with polling).
- **D** — archival/partitioning keeps hot-path query plans stable as the
  unbounded tables grow; load-test suite runs with SLOs defined.
- **All** — `./validate.sh` passes; versioning rules honoured per
  implementing phase.

---

## Risks and open questions

- **SSE + tRPC coexistence**: the SSE route is a plain route handler (like
  the chat stream), not a tRPC subscription — keeps tRPC v11 usage unchanged.
- **LISTEN/NOTIFY through transaction poolers**: LISTEN needs a session-mode
  connection. Once a pooler exists (new-infrastructure guide), the adapter
  must take a direct DB URL for its one listener connection
  (`DATABASE_LISTEN_URL`, defaulting to `DATABASE_URL`) while the app pool
  goes through the pooler. The Redis adapter removes this wrinkle.
- **Turn lease vs very long turns**: the lease TTL must comfortably exceed
  p99 turn duration — runtime config + per-chunk heartbeat re-stamping
  (item 9).
- **Auto-enrol scope**: product call before group B lands (item 11).
- **MCP/skills branch**: item 6 assumes `claude/ui-mcp-skills-refactor-5xt2w9`
  merges roughly as-is; if it changes shape, revisit the line items — the
  principles (deadline, parallel connect, cache immutable listings) hold.
  Skills lengthen the system prompt and the pre-pass adds a call, so the
  branch makes the LLM limiter and prologue parallelisation *more* urgent.

---

## Provenance

- Former `docs/development/to-be-implemented/scaling-to-concurrent-load.phase.md`
  — its P0 items were delivered in v1.49.0
  (`docs/development/implemented/v1.49.0/scaling-p0-pool-and-auth-cache.md`).
- Former `docs/development/to-be-implemented/concurrency-collaboration-and-cloud-readiness.phase.md`
  — its collaborative-session re-architecture (groups B–C here) supersedes
  the polling-based MVP architecture of
  `implemented/v1.17.0/realtime-collaborative-sessions.phase.md`.
- Related ADRs: ADR-006 (session schema), ADR-007 (session-scoped LangGraph),
  ADR-019 (in-app scheduler), ADR-026 (usage governance), ADR-032 (MCP tool
  calling).
