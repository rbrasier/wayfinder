# Phase — Concurrency Efficiency, Collaborative-Session Re-architecture & Cloud Readiness

- **Status**: Awaiting review (`/doc-review`), then staged implementation
- **Date**: 2026-07-01
- **Target version**: staged; each sub-phase bumps independently —
  - Sub-phase A (request-path efficiency, no schema change): **MINOR**
  - Sub-phase B (turn arbitration + participants — new tables/columns): **MINOR**
  - Sub-phase C (event bus + SSE fan-out): **MINOR**
  - Sub-phase D (cloud adapters/infra): mostly infra; any code (S3 adapter, Redis cache) **MINOR**
- **Depends on / relates to**:
  - [`scaling-to-concurrent-load.phase.md`](./scaling-to-concurrent-load.phase.md) —
    remains the authoritative roadmap for its P1/P2 items (LLM concurrency
    limiting, job queue, scheduler parallelism, streaming uploads, archival,
    read replica, load tests). This doc **does not duplicate** those items; it
    references them where they intersect.
  - `implemented/v1.49.0/scaling-p0-pool-and-auth-cache.md` — P0 delivered
    (env-driven pool, session/permission TTL cache, statelessness audit).
  - `implemented/v1.17.0/realtime-collaborative-sessions.phase.md` — the
    polling-based collaborative MVP. **§4 of this doc supersedes its
    architecture** (it was explicitly built as the smallest possible delta,
    with SSE/push named as the follow-up).
  - ADR-006 (session schema), ADR-007 (session-scoped LangGraph), ADR-019
    (in-app scheduler), ADR-026 (usage governance), ADR-032 (MCP tool calling —
    branch `claude/ui-mcp-skills-refactor-5xt2w9`).

---

## 1. Scope

Three questions, answered in order:

1. **Codebase** — what in the current request path wastes work per user, and
   what changes make each request cheaper so the same hardware carries more
   concurrent users? (§2, plus branch-specific findings in §3.)
2. **Architecture** — the collaborative-session design (multiple users in one
   chat window) is the weakest structural piece under concurrency. What should
   it look like instead? (§4 — the centrepiece of this doc.)
3. **Deployment** — the app will land on AWS or Azure. What must the codebase
   provide so that deployment is a mapping exercise rather than a rewrite? (§5.)

**Non-goals**: multi-region, multi-tenant sharding, CRDT co-editing of
message text or documents, and everything the scaling roadmap already lists as
out of scope. WebSockets are explicitly *not* proposed (§4.5 records why).

---

## 2. Codebase findings — where each request does avoidable work (main)

The v1.49.0 P0 work removed the auth round-trips and made the pool tunable.
What remains is dominated by **read amplification on session data** and
**unserialised writes**. Findings are ordered by measured impact at ~500
concurrent users, with evidence.

### 2.1 Unbounded message-history loads, several times per turn

`DrizzleSessionMessageRepository.listBySession` has no limit or cursor — it
loads the **entire** session history, ordered, every time. On one chat turn it
runs at least four times:

| Call site | Purpose |
| --- | --- |
| `GetSession.execute` (route entry) | full payload for prompt building |
| `RunTurn.persistUserMessage` | dedupe guard reads *all* messages to inspect the last one |
| `applyAdvanceSideEffects` (turn-helpers) | finds the milestone message — full list |
| `applyAdvanceSideEffects` again (`refreshed`) | rebuilds gathered context — full list |

The same full load also backs **every 3-second poll from every open window**
(§2.3). A 200-message session with three participants costs ~4 full-history
reads per turn plus ~1 per participant per 3 s, indefinitely.

**Change:**

- Add `latestBySession(sessionId, limit)` and `listSince(sessionId, afterCreatedAt | afterSeq)`
  to `ISessionMessageRepository` (cursor pagination; roadmap P2 #9 asks for
  this — pull it forward, it is cheap).
- `persistUserMessage`'s idempotency guard needs only the **last row**
  (`latestBySession(id, 1)`).
- Thread one loaded message list through the turn instead of re-reading:
  `applyAdvanceSideEffects` already receives `fallbackMessages`; make the
  freshly-persisted rows an explicit parameter instead of two re-reads.
- The prompt already effectively windows context (`experimental_prepareRequestBody`
  sends the last 20); make the server honour the same window from the DB
  rather than trusting the client copy (also removes the client-supplied
  transcript as an input — see §4.2 note).

### 2.2 Serial awaits in the stream route prologue

`apps/web/src/app/api/chat/[sessionId]/stream/route.ts` awaits sequentially:
org name → global instructions → uploads → upload config → user profile →
RAG retrieval. None depend on each other; all follow the `getSession` call.
That is ~6 round-trips of pure latency added to **every turn** while a pool
connection is held.

**Change:** one `Promise.all` for the independent reads. Further: org name,
global instructions, and upload config are near-static admin settings — front
`systemSettings.get` for these keys with the existing `TtlCache` (30–60 s TTL).
This is a pattern the container already established for auth; reuse it, don't
invent a second cache shape.

### 2.3 Polling is the dominant steady-state load (see §4 for the real fix)

Per open, visible chat window on an active session:

- `session.get` invalidated every **3 s** → full `GetSession` payload
  (session + full messages + flow + version snapshot/nodes/edges) plus the
  participant N+1 below.
- `session.typingUsers` every **2 s**.
- `session.heartbeatTyping` mutation every ~2 s **while typing** (each runs a
  delete + upsert).

At 500 open windows that is ≈ 165 full-history session reads/s + 250 typing
reads/s **at idle** — an order of magnitude more DB work than the chat turns
themselves. Polling also sets the collaboration latency floor (2–3 s). §4
replaces the transport; until then, §2.1's `listSince` at least makes each
poll cheap.

### 2.4 Participant hydration is an N+1

`session.get` (tRPC router) collects sender ids and issues one
`users.findById` **per participant** on every poll. Add
`IUserRepository.findByIds(ids)` (single `IN` query), or fold display names
into the message query with a join. Removed entirely once participants become
first-class rows (§4.3).

### 2.5 No server-side turn serialisation (correctness under concurrency)

The v1.17.0 decision "lock Send, not the textarea" is **client-side only**
(`isLoading` is local to each window). Two participants — or one user with a
retry — can POST the stream route simultaneously. Each request then:

1. loads the session (both see the same `currentNodeId`),
2. persists a user message (the dedupe guard won't catch different texts),
3. runs the full LLM turn (double spend),
4. calls `sessions.update(...)` — **last-writer-wins**, no version check
   (`DrizzleSessionRepository.update` is a plain `UPDATE … WHERE id`),
5. may both advance, or advance twice through different branches.

The same read-modify-write pattern applies to `Session.pendingExecutions`
(a JSON blob rewritten wholesale by auto-node/n8n callbacks — and, on the
feature branch, by MCP confirmation parking).

**Change:** §4.2 (turn lease) + §4.4 (optimistic version column). This is the
single most important correctness fix in this doc.

### 2.6 Fire-and-forget background work is process-bound

`void generateDocument(...)`, `void generateTitle(...)`, and the notifier
fire-and-forgets run detached inside the web process. A deploy/restart/crash
mid-generation loses the work silently (documents stay `pending` until the
client polls forever; the null-status legacy handling in `_content.tsx` exists
precisely because of this). Roadmap P1 #6 (job queue: pg-boss vs BullMQ)
already owns the fix — this doc adds two constraints to that decision:

- Document generation and step-advance side effects (§2.5's `applyAdvanceSideEffects`
  chain: doc-gen, auto-node dispatch, initial-message generation) should be
  the **first migrated producers**, since they hold LLM calls open inside a
  streaming HTTP response today.
- §5's cloud recommendation adds Redis anyway (shared auth cache + event bus),
  which tilts the P1 queue choice to **BullMQ**.

### 2.7 Per-turn LLM fan-out is unbounded (roadmap wall #5, quantified)

One conversational turn can issue up to **six** model calls: main structured
stream, branch choice, readiness evaluation, gap follow-up stream, next-step
initial message, and title generation. The feature branch adds a seventh (the
MCP tool pre-pass, §3.1). None run under a concurrency limiter or budget.
Roadmap P1 #5 owns the limiter; the numbers here justify prioritising it —
500 concurrent turns can mean ~3000 in-flight provider calls.

### 2.8 Small but free wins

- `GetSession` fetches the flow-version snapshot on every poll; snapshots are
  immutable — cache them per `flowVersionId` in `TtlCache` (they already back
  the ADR-007 compiled-graph cache key, so the pattern exists).
- `apps/web/src/app/api/chat/[sessionId]/uploads/route.ts` buffers whole files
  in memory and extracts inline (roadmap P1 #8 — unchanged, still true).
- `session.get`'s poll payload includes `nodes`/`edges` (static per pinned
  version) on every tick; split "definition" (cache-forever per version) from
  "state" (session row + message delta) so polls only carry state.

---

## 3. Branch findings — `claude/ui-mcp-skills-refactor-5xt2w9`

The branch adds skills (SKILL.md injection into step prompts) and MCP servers
(context tool-loop pre-pass + `mcp` action nodes, ADR-032). Functionally sound;
under concurrency four things need attention **before** this branch's features
meet real load:

### 3.1 The MCP tool pre-pass is a serial, unbudgeted LLM+network stage

`runMcpToolPrepass` runs **before** the streaming turn on any step with
allowed tools: it opens a fresh SSE MCP client **per server, sequentially**
(`McpToolPrepass.run` loops `await experimental_createMCPClient` then
`await client.tools()`), then runs a non-streaming `generateText` with up to
4 tool steps. Consequences at load:

- Adds full seconds of dead air before the first streamed token (worst case:
  N server handshakes + N `tools()` listings + up to 4 sequential tool calls +
  one extra LLM round-trip), while the HTTP response and a DB connection stay
  open.
- No timeout or wall-clock budget: a slow MCP server stalls the turn
  indefinitely.
- Tool listings are re-fetched **per turn** even though a server's tool list
  changes rarely.

**Changes:**

- Connect to servers with `Promise.all`, not a loop.
- Wrap the whole pre-pass in a configurable deadline (e.g. 10 s default via
  runtime config) — on expiry, skip tools and run the turn without them
  (mirrors the readiness gate's fail-open convention).
- Cache `listTools` per server id in `TtlCache` (60 s+); invalidate on admin
  server edits. The per-call client-open in `AiSdkMcpClient` is fine (the SDK
  doesn't pool), but the *listing* result is cacheable even if the connection
  isn't.
- Count the pre-pass in the P1 LLM concurrency limiter and in ADR-026 quota
  enforcement (it already records usage; make sure the enforcer gates it too).

### 3.2 Skills resolution reads the DB per turn

`resolveStepSkills` fetches skill rows on every turn for the step. Skill
bodies are immutable-ish admin content — same `TtlCache` treatment, keyed by
skill id set.

### 3.3 MCP confirmation parking widens the `pendingExecutions` race

`PrepareMcpNode` parks resolved tool args in `Session.pendingExecutions` and
sets `awaitingConfirmationNodeId`; `ConfirmMcpNode` later reads and executes.
Both are read-modify-write on the same JSON blob that n8n callbacks also
rewrite — with no version guard, a callback landing during a confirm can drop
one of the two writes. The §4.4 version column must cover these paths, and the
blob should move to guarded updates (`UPDATE … SET pending_executions = …
WHERE version = $expected`).

### 3.4 The branch raises per-turn cost — sequencing consequence

Skills lengthen the system prompt (more prompt tokens per turn — partially
absorbed by Anthropic prompt caching only if the skill text sits in the cached
prefix; verify placement in `buildSystemPrompt`), and the pre-pass adds a call.
Net: the branch makes §2.7's limiter and §2.2's parallelisation **more**
urgent, not less. Merge order recommendation: land Sub-phase A (§6) either
before the branch merges or immediately after, ahead of any load growth.

---

## 4. Collaborative sessions re-architected (the centrepiece)

### 4.1 What exists, and why it's the wrong shape to grow

The v1.17.0 design was explicitly a minimal MVP; all three of its core
decisions trade robustness for zero new infrastructure:

| Decision (v1.17.0) | Cost today |
| --- | --- |
| **Transport = polling** (3 s session poll, 2 s typing poll, 2 s heartbeats) | Dominant idle DB load (§2.3); 2–3 s message latency; collaborators can't see the AI reply *streaming* — it pops in whole after completion; typing presence costs a DB write per 2 s per typer |
| **Write access = anyone with the link** (session UUID as capability) | No participant record, no revocation, no audit of who joined; an approver or ex-employee with the URL writes forever; `?shared=true` is a *client-side* flag, so "read-only shared viewer" is cosmetic — the stream route accepts a POST from any authenticated holder of the UUID |
| **Concurrency = lock Send client-side** | No server arbitration at all (§2.5): double turns, double spend, double advance |

None of these are fixable by tuning the poll interval. The re-architecture
below keeps v1.17.0's *product* semantics (append-only messages, one shared
conversation, one AI turn at a time, typing dots) and replaces the *machinery*.

### 4.2 Server-side turn arbitration — a lease on the session

**New behaviour:** the stream route must **claim the turn** before doing any
work, and every window learns the truth from the server.

- Add to `app_sessions`: `active_turn_id uuid null`,
  `active_turn_claimed_by uuid null`, `active_turn_claimed_at timestamp null`.
- Claim = one atomic conditional update (no advisory locks, works through
  transaction poolers):

  ```sql
  UPDATE app_sessions
  SET active_turn_id = $turnId, active_turn_claimed_by = $userId,
      active_turn_claimed_at = now()
  WHERE id = $sessionId
    AND (active_turn_id IS NULL OR active_turn_claimed_at < now() - interval '120 seconds')
  RETURNING id;
  ```

  Zero rows → someone else holds the turn → the route returns **409** with the
  holder's name; the composer shows "Alex's turn is in progress". The
  120 s staleness window is the crash-recovery lease: a process that dies
  mid-turn frees the session automatically, without operator intervention.
- Release = clear the three columns in the same write that persists the
  assistant turn (success) or in the stream's error path (failure).
- Expose the claim through the domain as `ISessionRepository.claimTurn /
  releaseTurn` returning `Result` — the Result pattern already models
  "conflict" cleanly as a domain error (`CONFLICT`).
- `persistUserMessage` happens **after** a successful claim, which closes the
  §2.5 double-message window; the claim also serialises `pendingExecutions`
  writers on the chat path.

This is deliberately a *pessimistic* lock for the turn itself (turns are long,
seconds-scale, and exclusive by product design — v1.17.0 already wanted "one
turn at a time", it just couldn't enforce it) combined with *optimistic*
versioning (§4.4) for every other session write.

### 4.3 Participants become rows, not URL knowledge

**New table `app_session_participants`** (group prefix `app_`):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `session_id` | uuid not null FK → `app_sessions` | unique with `user_id` |
| `user_id` | uuid not null FK → `core_users` | |
| `role` | text not null | `owner` \| `collaborator` \| `viewer` |
| `joined_at` | timestamp not null default now() | |
| `invited_by` | uuid null FK → `core_users` | audit trail |
| `created_at` / `updated_at` | timestamp | per repo convention |

- **Joining stays link-based** (the product likes frictionless sharing):
  opening the collaborate link **auto-enrols** the authenticated user as a
  `collaborator` (audited via `LogAuditEvent`), rather than silently granting
  ambient write. The UX is unchanged; the security model is no longer "the
  URL is the credential forever" — an owner/admin can list and **revoke**
  participants, and revocation actually means something because the stream
  route now authorises against the table:

  ```
  owner/collaborator → may send;  viewer (e.g. approvers) → read-only;
  not a participant → may auto-enrol via the share link, else 403.
  ```

- `?shared=true` stops being the read-only signal; the server-computed
  participant role is. (The existing approver read-only grant maps to
  `viewer`.)
- `session.get`'s participant N+1 (§2.4) disappears — one join on this table.
- Presence ("who has the window open") derives from live event-bus
  subscriptions (§4.5), **not** DB heartbeats. The `app_session_typing` table
  and its delete-on-heartbeat cleanup are retired in sub-phase C.

### 4.4 Optimistic concurrency for session state

Add `version integer not null default 1` to `app_sessions`. Every
`DrizzleSessionRepository.update` becomes
`UPDATE … SET version = version + 1 … WHERE id = $id AND version = $expected`,
with zero-rows mapped to a `CONFLICT` domain error. Callers (advance,
confirm-step, override-branch, approval decisions, auto-node/MCP callbacks)
reload-and-retry once, or surface the conflict. The turn lease already
serialises chat-path writers, so conflicts should be rare — the version column
is the backstop for the *non-chat* writers (webhooks, scheduler, approvals)
that the lease doesn't cover.

### 4.5 Transport: session event bus + SSE fan-out (replacing polling)

**Decision: Server-Sent Events, not WebSockets.**
The data flow is one-directional — sends already go through the existing POST
(which must stay an HTTP request for the AI stream anyway), so the only
missing piece is *server → other windows*. SSE gives that with a plain
streaming `GET` route (Next.js App Router supports this natively — the chat
stream already holds responses open the same way), needs no protocol upgrade,
no sticky sessions, passes every corporate proxy that already carries the chat
stream, and auto-reconnects with `Last-Event-ID` built into the browser
`EventSource`. WebSockets would add a stateful upgrade path, a second server
runtime concern on serverless-ish hosts, and buy nothing the product needs.

**Decision: an `ISessionEventBus` port with two adapters, staged.**

```ts
// packages/domain/src/ports/session-event-bus.ts
interface ISessionEventBus {
  publish(sessionId: string, event: SessionEvent): Promise<Result<void>>;
  subscribe(sessionId: string, handler: (event: SessionEvent) => void): Promise<Result<Unsubscribe>>;
}
```

- **Adapter 1 (no new infra): Postgres `LISTEN/NOTIFY`** via the existing
  `postgres.js` driver (`db.listen` uses a dedicated connection per process,
  not one per subscriber). Payloads stay under the 8 KB NOTIFY limit by
  publishing **notifications, not data**: `{type, sessionId, seq}` — the SSE
  handler fetches the delta via `listSince` (§2.1). Works correctly with
  multiple app instances (each instance holds one LISTEN connection and fans
  out in-process to its own SSE subscribers).
- **Adapter 2 (when Redis lands for the shared auth cache / BullMQ): Redis
  pub/sub** — drop-in behind the same port; removes the per-instance LISTEN
  connection and scales fan-out independently of Postgres.

**Event vocabulary** (also the SSE `event:` names):

| Event | Emitted by | Payload |
| --- | --- | --- |
| `turn.claimed` / `turn.released` | claim/release in stream route | `{userId, name}` — drives every window's Send-disabled state *truthfully* |
| `message.created` | `persistUserMessage`, `persistAssistantTurn`, system messages | `{seq}` → client fetches delta |
| `turn.delta` | the streaming loop in `stream-turn.ts` | `{turnId, text}` — **collaborators watch the reply stream live**, closing the "reply pops in whole" gap |
| `typing` | composer keystrokes (throttled POST) | `{userId, name}` — ephemeral, never persisted; replaces `app_session_typing` |
| `session.updated` | advance / confirm / approval / document status | `{seq}` → client refetches session *state* (not definition, §2.8) |

**Sequencing & resume:** add a monotonic `seq bigint` per session on
`app_session_messages` (or reuse `created_at` + id tiebreak). The SSE route
replays `listSince(lastEventId)` on reconnect, so a dropped connection loses
nothing. `turn.delta` is fire-and-forget (a reconnecting client just waits for
`message.created` of the final text — same behaviour as today's poll).

**Fallback:** keep a *slow* poll (15–30 s) as a degraded mode when the SSE
connection cannot be established, using the same `listSince` delta — never the
full payload. The 2 s typing poll and 3 s session poll are deleted.

**Client:** `_content.tsx` swaps its two `refetchInterval` loops + visibility
juggling for one `EventSource`; `useChat` keeps handling the *sender's* own
stream exactly as today.

### 4.6 What deliberately does not change

- Append-only messages, no co-editing, no CRDTs (ADR-006 stance).
- One AI turn at a time per session — now enforced instead of hoped.
- The agent stays ignorant of which human sent a message (sender is display
  metadata only).
- `useChat`/Vercel AI SDK on the sender's own path.
- Read-only share links continue to work; they become `viewer` enrolments.

---

## 5. Cloud readiness (AWS / Azure)

The hexagonal layout means deployment is mostly adapter selection + infra
mapping. The table is the target shape; the **code prerequisites** column is
what this repo must produce (everything else is ops).

| Concern | Today | AWS | Azure | Code prerequisite |
| --- | --- | --- | --- | --- |
| Web (`apps/web`) | Node process | ECS Fargate service (or App Runner) behind ALB | App Service / Container Apps | **Dockerfile** (none exists); SSE needs ALB idle timeout ≥ turn length (~300 s) — same requirement the chat stream already has |
| Worker (`apps/api`: scheduler, webhooks) | Node process | Separate always-on ECS service | Separate Container App | Already isolated — keep it off serverless (long-lived poll loop, per the scaling doc) |
| Postgres + pgvector | Docker compose | RDS/Aurora PostgreSQL (pgvector supported) **+ RDS Proxy** | Azure Database for PostgreSQL Flexible Server (pgvector) + PgBouncer | None — pool already env-driven (v1.49.0); pooler satisfies roadmap P0 #2 |
| Object storage | MinIO | S3 | Blob Storage (or S3-compatible via MinIO gateway) | `MinioStorageAdapter` speaks S3 already — parametrise endpoint/region/credentials for native S3; Blob needs a small new `IObjectStorage` adapter **or** keep the S3 API via gateway |
| Cache / event bus / queue | in-process `TtlCache`; none; none | ElastiCache Redis | Azure Cache for Redis | Redis adapters behind existing seams: shared auth cache (v1.49.0's named promotion), `ISessionEventBus` adapter 2 (§4.5), BullMQ for roadmap P1 #6 |
| Email | SMTP/M365 | SES or keep M365 | ACS or keep M365 | None — transport is runtime-configured (ADR-023) |
| Secrets (incl. MCP `credentialRef`) | env vars | Secrets Manager → env | Key Vault → env | None — `credentialRef` already resolves env var names, so injection is an infra concern |
| Observability | Langfuse + Pino | CloudWatch + Langfuse (OTel wired) | App Insights + Langfuse | None |
| Embeddings (local mode) | in-process transformer | fine on Fargate (CPU) or switch provider | same | Already provider-switchable (ADR-017) |

Notes:

- **One decision to take deliberately**: Bedrock is already a supported LLM
  provider — on AWS this collapses the provider secret story to IAM. Not a
  prerequisite.
- **Stateless holds** (v1.49.0 audit) *provided* the three promotions happen
  when instance count > 1: shared auth cache → Redis, event bus → Redis,
  background work → queue. The SSE fan-out design (§4.5) is multi-instance
  correct from day one because publishes traverse the bus, never process
  memory.
- No Kubernetes requirement at this scale; container services + managed data
  is the recommended default, consistent with the scaling doc's PaaS
  recommendation. Air-gap/PKI signals would flip this to AKS/EKS +
  self-hosted MinIO/PgBouncer — the adapters keep both open.

---

## 6. Sequenced sub-phases

Ordered so that every stage is independently shippable and each removes the
riskiest remaining failure mode first. Items already owned by the scaling
roadmap stay there (marked ↗).

### Sub-phase A — Request-path efficiency (no schema change; MINOR)

1. `latestBySession` / `listSince` on the message repository; single
   message-load per turn; last-row dedupe (§2.1).
2. `Promise.all` the stream-route prologue; `TtlCache` in front of the three
   static settings reads and flow-version snapshots (§2.2, §2.8).
3. `findByIds` participant hydration (§2.4).
4. Branch (if merged): parallel MCP connects, pre-pass deadline + fail-open,
   tools-list and skills caching (§3.1, §3.2).
5. ↗ LLM concurrency limiter (roadmap P1 #5) — do it in this window; §2.7 and
   §3.4 raise its priority.

### Sub-phase B — Correctness under concurrency (schema: columns + 1 table; MINOR)

6. Turn lease columns + `claimTurn`/`releaseTurn` + 409 path + composer state
   (§4.2).
7. `version` column + guarded session updates, covering `pendingExecutions`
   writers (§4.4, §3.3).
8. `app_session_participants` + auto-enrol on share link + role-based
   authorisation in stream route and `session.get` + revocation UI (owner
   menu) (§4.3).

### Sub-phase C — Event bus + SSE (schema: `seq`; MINOR)

9. `ISessionEventBus` port + `LISTEN/NOTIFY` adapter + SSE route +
   `EventSource` client; delete the 2 s/3 s polls; slow-poll fallback (§4.5).
10. Typing + presence over the bus; retire `app_session_typing` (§4.3, §4.5).
11. `turn.delta` live streaming to collaborators (§4.5).

### Sub-phase D — Cloud landing (infra + small adapters)

12. Dockerfiles for both apps; pooler in front of Postgres (↗ P0 #2).
13. Redis: shared auth cache promotion (↗ named in v1.49.0), event-bus
    adapter 2, then ↗ BullMQ for P1 #6 with doc-gen/advance side effects as
    first producers (§2.6).
14. Native S3 (and/or Blob) storage adapter parametrisation (§5).
15. ↗ Load tests (roadmap P2 #11) gate each sub-phase's exit.

---

## 7. Acceptance criteria (per sub-phase)

**A** — a turn on a 500-message session performs ≤ 1 full message read
(measured via query logging); stream-route time-to-first-token improves
measurably vs baseline; MCP pre-pass never exceeds its deadline in fault
injection.

**B** — two simultaneous sends into one session: exactly one runs, the other
receives 409 with holder attribution; kill -9 mid-turn frees the session
within the lease window; a stale-version session update returns `CONFLICT`,
never silently overwrites; a revoked collaborator's next send is 403; every
join/revoke is in the audit log.

**C** — with two windows on one session: a message appears in the other
window in < 500 ms (LAN); the AI reply *streams* in the collaborator's window;
typing dots appear/disappear with zero rows in (the now-deleted)
`app_session_typing`; killing the SSE connection and reconnecting replays the
missed messages via `Last-Event-ID`; steady-state DB queries per idle open
window drop to ~0 (vs ~0.8/s today).

**D** — both apps run as containers behind a pooler with N=2 replicas; logout
on instance 1 is honoured on instance 2 within cache TTL (shared cache); a
mid-generation deploy re-runs document generation from the queue instead of
losing it.

**All** — `./validate.sh` passes; versioning rules honoured per sub-phase;
each sub-phase moves its slice of this doc to `implemented/` per the skills
workflow (this doc stays until the last lands, mirroring the scaling roadmap's
convention).

---

## 8. Risks & open questions

- **tRPC + SSE coexistence**: the SSE route is a plain route handler (like the
  chat stream), not a tRPC subscription — keeps tRPC v11 usage unchanged.
  Confirm the chosen host's proxy/ALB streaming limits once §5's platform is
  picked.
- **LISTEN/NOTIFY through transaction poolers**: LISTEN requires a session-mode
  connection. The adapter must take a **direct** DB URL for its one listener
  connection (env: `DATABASE_LISTEN_URL`, defaulting to `DATABASE_URL`) while
  the app pool goes through the pooler. Redis adapter removes this wrinkle.
- **Turn lease vs very long turns**: doc-gen-heavy turns can exceed 120 s; the
  lease TTL must comfortably exceed p99 turn duration (make it runtime config,
  and have the in-flight turn re-stamp `active_turn_claimed_at` on each stream
  chunk as a heartbeat).
- **Auto-enrol scope**: should *any* authenticated user with the link become a
  collaborator, or only users the flow is visible to? Recommend: honour flow
  visibility (private flows → owner must be able to see enrolments and the
  admin flag gates nothing extra). Product call before Sub-phase B.
- **Branch merge order**: §3's fixes assume the MCP/skills branch merges
  roughly as-is; if it changes shape, revisit §3 line items but the principles
  (deadline, parallel connect, cache immutable listings) hold.
