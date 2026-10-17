# Phase — Read-Only Public-Data MCP Servers in Flows

- **Status**: Implemented (v0.40.0) — see `public-data-mcp-servers.summary.md`
- **Target version**: 0.40.0 (bump: MINOR — schema change: `admin_mcp_servers` classification,
  timeout and encrypted secrets; `admin_mcp_tools` per-tool settings; new `job_mcp_calls` queue)
- **Base branch**: `main` (release line `alpha-3`)
- **Source issue**: rbrasier/wayfinder#333 (split from #332, part A; prerequisite for #334)
- **PRD**: none — an enhancement to the MCP integration. The issue is the requirement;
  `docs/development/prd/data-provenance-and-verbatim-governance.prd.md` covers the verbatim-only
  handling this phase must keep working.
- **ADRs**: ADR-062 (new — decisions for this phase; first written MCP ADR, see §9), ADR-033
  *Immutable Audit Log & Legal Hold*, ADR-049 (flow import resolution), ADR-050 (external field
  values), ADR-053 (provenance and verbatim-only — unchanged), ADR-060 (audit actor context)

## 1. Problem

Wayfinder has an MCP client but cannot use read-only public-data servers. Verified against `main`
at `17e7d2a`:

- **Refused in flows.** `communicatesExternally = true` is the only classification for any
  server that reaches outside Wayfinder. It is dropped from the author directory
  (`packages/adapters/src/mcp/mcp-server-directory.ts:26`), from step tool resolution
  (`packages/application/src/use-cases/mcp/mcp.ts:183`) and refused at runtime
  (`packages/application/src/use-cases/session/run-mcp-node.ts:91`).
- **Old protocol, lossy results.** `AiSdkMcpClient` uses `experimental_createMCPClient` from
  `ai@4.3.19`, which negotiates only protocol `2024-11-05`/`2024-10-07`. `listTools` returns
  `inputSchema: null`; `flattenResult` keeps text and discards `structuredContent` and
  `resource_link` blocks. Nothing follows pagination.
- **Short, blocking calls.** A fixed 8 s cap per call (`MCP_CALL_TIMEOUT_MS`), a 15 s default
  for the whole pre-pass, neither configurable. The MCP node calls the tool while the turn lease
  is held.
- **Cut audit copy.** The pre-pass stores each result cut to 4,000 characters
  (`mcp-tool-prepass.ts:61`), and that cut copy is what later turns re-inject. Nothing reaches
  `core_audit_log`.
- **No citations, no status.** There is no citation model for tool output. Empty results read
  as "nothing found" whether the source had no data or was down.
- **Weak credentials.** A bearer token read from an `MCP_CRED_*` environment variable, shared by
  every server that names it; no custom headers.
- **Unused cache.** `admin_mcp_tools` exists in the schema and is never read or written.

Corrections to the issue text, for the record: the 8,000-character cap at `run-mcp-node.ts:59`
applies to the transcript sent for field resolution, not to MCP node output, which is not
truncated today; the MCP SDK is at `^1.31.0` (1.32.1 installed), not `^1.12`.

## 2. Goals

- An admin classifies a server as `internal`, `public-read` or `external-write`. `public-read`
  servers are offered to flow authors and run in flows; `external-write` stays refused.
- Wayfinder talks to Streamable HTTP servers that run without sessions, verified against a
  fixture.
- An admin sets each server's call timeout. An MCP node's call no longer holds the turn.
- While a tool is being called, the chat says so: "Calling *Legislation search*…", updated
  when each new page is requested and every 5 s while still waiting.
- Results are kept whole: pagination followed (when configured), `structuredContent` and links
  kept, nothing cut without saying so.
- Briefings cite their sources: assistant replies show the source records they used, and fields
  captured from a tool result carry those records.
- A source's own status ("no data", "source unavailable", "upstream gap") and caveats reach the
  model and the person, with a confidence.
- Every call is in `core_audit_log`. Credentials and custom headers are stored encrypted per
  server.
- Tool input schemas come from the `admin_mcp_tools` cache and drive the editor's request
  fields.
- The local mocks include public-data tools with sample records, several pages, a 20 s tool and
  empty-with-reason results, so all of the above can be exercised without a real source.

## 3. Non-goals

- The stateless 2026-07-28 protocol (no `initialize` handshake). No released TypeScript client
  implements it (ADR-062 §2); follow-up once the SDK ships it.
- Per-organisation credentials. Servers stay deployment-wide.
- Write-capable external integrations. `external-write` stays blocked in flows.
- A default convention for pagination, status or citation fields. Only configured tools get
  them (ADR-062 §5).
- Moving the conversational pre-pass off the turn.
- Citations rendered inside generated documents.
- Issue #334.

## 4. Design

### 4.1 Classification (`packages/domain/src/entities/mcp-server.ts`)

```typescript
export type McpDataClassification = "internal" | "public-read" | "external-write";
export const MCP_DATA_CLASSIFICATIONS: readonly McpDataClassification[] = [
  "internal",
  "public-read",
  "external-write",
];
export const isFlowUsableClassification = (value: McpDataClassification): boolean =>
  value !== "external-write";
```

`McpServer.communicatesExternally` is replaced by `dataClassification`. Every reader switches to
`isFlowUsableClassification`: the directory, `ResolveStepTools`, `RunMcpNode`, and the flow import
resolver (`flow-import-resolve.ts`, `inspect-flow-import.ts`), which today refuses an import
whose MCP node points at an external server.

### 4.2 Server settings and secrets

```typescript
export interface McpServer {
  // …existing fields, minus credentialRef and communicatesExternally
  readonly dataClassification: McpDataClassification;
  readonly callTimeoutMs: number;          // 1_000–120_000, default 30_000
  readonly hasCredential: boolean;
  readonly customHeaderNames: string[];
}

// Write-only. Never returned by a repository read or a router.
export interface McpServerSecrets {
  readonly bearerToken: string | null;
  readonly headers: Record<string, string>;
}
```

- New domain port `IMcpServerSecretStore { get(serverId); set(serverId, patch) }`. The adapter
  (`DrizzleMcpServerSecretStore`) encrypts with `SettingsEncryptionService` into
  `credential_ciphertext` / `custom_headers_ciphertext`, and decrypts only for the MCP client.
- `RegisterMcpServer` / `UpdateMcpServer` take `bearerToken?: string | null` and
  `customHeaders?: Record<string,string> | null` (undefined = unchanged, null = clear) and
  validate header names (`validateMcpCustomHeaders` in domain): RFC 7230 token characters only;
  refuses `host`, `content-length`, `content-type`, `accept`, `mcp-session-id`,
  `mcp-protocol-version`, `last-event-id`; refuses `authorization` when a bearer token is set.
- `isValidMcpCredentialRef` and `MCP_CREDENTIAL_ENV_PREFIX` are deleted.

### 4.3 Tool cache and per-tool settings (`admin_mcp_tools`)

```typescript
export interface McpToolPagination {
  readonly cursorArgument: string;   // argument the cursor is sent in, e.g. "cursor"
  readonly nextCursorPath: string;   // dotted path in the result, e.g. "next_cursor"
  readonly itemsPath: string;        // dotted path to the array concatenated across pages
  readonly maxPages: number;         // 1–20
}
export type McpSourceStatusKind = "ok" | "no-data" | "source-unavailable" | "upstream-gap";
export interface McpToolStatusMapping {
  readonly statusPath: string;
  readonly meanings: Record<string, McpSourceStatusKind>;
  readonly caveatsPath: string | null;
}
export interface McpToolCitationMapping {
  readonly recordsPath: string;
  readonly locatorField: string;
  readonly titleField: string | null;
  readonly urlField: string | null;
  readonly timestampField: string | null;
}
export interface McpTool {
  readonly name: string;
  readonly title: string | null;      // MCP tool title / annotations.title
  readonly description: string | null;
  readonly inputSchema: Record<string, unknown> | null;
}
export interface McpToolSettings {
  readonly pagination: McpToolPagination | null;
  readonly status: McpToolStatusMapping | null;
  readonly citation: McpToolCitationMapping | null;
}
export interface CachedMcpTool extends McpTool, McpToolSettings {
  readonly serverId: string;
  readonly lastSyncedAt: Date;
}
```

- New port `IMcpToolRepository`: `listByServer`, `replaceForServer(serverId, tools)` (upserts by
  name, removes tools the server no longer lists, **keeps settings** for names that survive),
  `updateSettings(serverId, toolName, settings)`.
- New use cases `RefreshMcpTools` (live `listTools` → `replaceForServer`) and
  `UpdateMcpToolSettings` (validates paths are non-empty dotted identifiers, `maxPages` 1–20,
  meanings non-empty).
- `TestMcpServer` refreshes the cache on success. `McpServerDirectory` reads the cache and falls
  back to a live list (and caches it) when the cache is empty.
- The domain owns the pure result helpers (`readPath`, `applyStatusMapping`,
  `extractCitations`) so they are tested without a server.

### 4.4 Client (`packages/adapters/src/mcp/mcp-sdk-client.ts`, replaces `ai-sdk-mcp-client.ts`)

```typescript
export interface McpCallOptions {
  readonly settings?: McpToolSettings;
  readonly onProgress?: (progress: { page: number }) => void;
  readonly signal?: AbortSignal;
}
export interface McpToolCallOutput {
  readonly output: string;                       // text the model / response field reads
  readonly structuredContent: unknown | null;    // combined across pages when paginated
  readonly citations: ToolRecordCitation[];
  readonly pagesFetched: number;
  readonly truncatedAtPageLimit: boolean;
  readonly sourceStatus: McpSourceStatus | null;
}
export interface McpSourceStatus {
  readonly kind: McpSourceStatusKind;
  readonly raw: string;
  readonly caveats: string[];
  readonly confidence: number;  // ok 1, no-data 1, upstream-gap 0.5, source-unavailable 0
}
```

- `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` or
  `SSEClientTransport`; headers from `IMcpServerSecretStore`. One client per call, always
  closed (as today).
- Each request uses the SDK `RequestOptions` timeout set to the server's `callTimeoutMs` (verify
  the option shape in `node_modules`), and the caller's `signal`.
- `listTools` returns `inputSchema` and `title`.
- `callTool` follows pagination when `settings.pagination` is set: re-calls with
  `{ ...args, [cursorArgument]: cursor }` while the next cursor is a non-empty string and
  `pagesFetched < maxPages`; concatenates `itemsPath` arrays into the first page's structure.
  `onProgress` fires before each page. Structured data comes from `structuredContent`, falling
  back to JSON-parsing the text content.
- `output` is the text content when the result is a single unstructured page, else the JSON of
  the combined structure, followed by a plain-language line when the page limit was hit or the
  status is not `ok` (e.g. `Source status: source unavailable — absence of results does not mean
  none exist.`) and each caveat.
- `resource_link` blocks become citations; `settings.citation` adds records from
  `recordsPath`. A citation URL is kept only when it parses as `http:`/`https:`.
- An `isError` result is an `INFRA_FAILURE` carrying the tool's text.

The `ai` dependency stays in `packages/adapters` for the pre-pass model loop.
`experimental_createMCPClient` is no longer imported anywhere.

### 4.5 Auditing decorator (`AuditingMcpClient`)

`IMcpClient.callTool` gains an optional `context: McpCallContext` (`actorId`, `sessionId`,
`flowId`, `nodeId`, `path: "prepass" | "node"`). `AuditingMcpClient` wraps the SDK client and
writes one `core_audit_log` row per call, success or failure:

```typescript
{
  actorId: context.actorId,
  action: "mcp.tool.called",
  resourceType: "mcp_server",
  resourceId: server.id,
  metadata: {
    toolName, path, sessionId, flowId, nodeId,
    arguments,               // what was sent to the source; capped at 8,000 chars, flagged
    outcome: "ok" | "error",
    errorMessage, pagesFetched, truncatedAtPageLimit,
    resultChars, sourceStatus, durationMs,
  },
}
```

An audit failure is logged and never fails the call (the call already happened).

### 4.6 Conversational pre-pass (`packages/adapters/src/mcp/mcp-tool-prepass.ts`)

- The `ToolSet` is built from `IMcpToolRepository` (falling back to live `listTools`) as AI SDK
  `tool({ description, parameters: jsonSchema(inputSchema ?? { type: "object" }), execute })`,
  where `execute` calls `IMcpClient.callTool` with the tool's settings and the turn's context.
  Names stay server-prefixed and collision-safe (`prefixToolName`, `uniqueKey` unchanged).
- New input `onToolProgress(progress: ToolProgress)`. The pre-pass emits `running` at start, on
  each page, every 5 s while the call is in flight, and `done` on completion.
- The overall budget is `maxSteps × max(callTimeoutMs of the servers used)`, capped at 120 s.
- `McpToolCallRecord` gains `serverId`, `citations`, `sourceStatus`, `pagesFetched`,
  `truncated`; `result` holds the full `output` up to 200,000 characters (then `truncated:
  true`). Arguments keep their 1,000-character audit cap on the message (the audit log has
  them at 8,000).
- `mcp-turn-helpers.ts` numbers every citation in the combined prior and new records `S1…Sn`,
  renders each record's result followed by its status line and its citations (`[S3] Title —
  locator`), and adds to the system text: "When a statement relies on a source record, cite it
  with its marker, e.g. [S3]." Re-injection keeps a prompt budget of 60,000 characters across
  all records; anything past it is replaced by `[n characters omitted — call the tool again for
  the full result]`, never dropped silently.
- The route (`stream/route.ts`) passes `onToolProgress` to publish `tool.progress` session
  events.

### 4.7 Citations in the reply (`AiTurnPayload.citations`)

After the structured turn, `resolveCitedSources(response, numberedCitations)` keeps the
citations whose markers appear in the reply, in marker order, and they are stored on the
assistant message's `aiPayload.citations`. The message feed renders a **Sources** list under an
assistant bubble that has citations: `[S3] Title` linked to the URL when present, then locator
and date. Markers stay in the text as written. Messages without citations render as today.

### 4.8 Queued MCP node calls

`job_mcp_calls` (see §5) holds one row per call. Domain entity `McpCallJob`; port
`IMcpCallQueue { enqueue, claimDue(limit, staleBefore), markSucceeded, markFailed,
failStale }`.

- `RunMcpNode` (application): validation unchanged except the classification check; resolves
  request fields as today; records the pending execution; enqueues
  `{ sessionId, flowId, nodeId, correlationId, serverId, toolName, arguments, actorId }`;
  returns `{ status: "pending", correlationId }`. An enqueue failure clears the pending entry and
  returns the error.
- `dispatchMcpNode` (web): on `pending`, posts the system message
  `Calling <tool title> for step <node name>…` and publishes `session.updated`; it no longer
  calls `ApplyAutoNodeResult`.
- `ExecuteQueuedMcpCalls` (application, new): claims up to N due rows; for each, loads the
  server and tool settings, re-checks status and classification (a server disabled or
  reclassified while queued fails the job), calls the client with progress and context
  `path: "node"`, then:
  - **success** → `ApplyAutoNodeResult` with `data: { output }`, `verbatim:
    server.verbatimOnly`, and `citations`; posts `Completed tool step: <node name>.`; when the
    status kind is not `ok`, the message names it ("…the source reported no data.");
  - **`source-unavailable`** → treated as a failure: clears pending, posts
    `This tool step (<node name>) could not run: the source is unavailable.`;
  - **failure / timeout** → `ApplyAutoNodeResult` with `status: "failed"` (clears pending), posts
    the existing `could not run` message, logs to the error log.
  Each outcome publishes `message.created`/`session.updated` and a final `tool.progress` `done`.
- `McpCallWorker` (adapters, new): extraction-worker shape — 2 s tick, non-overlapping,
  `job_registry` name `mcp_call_worker`. Rows `running` longer than `callTimeoutMs + 60 s` are
  failed by `failStale` (the session's pending entry is cleared through the same failure path).
- `ApplyAutoNodeResultInput` gains optional `citations?: ToolRecordCitation[]`; when present,
  `persistStepOutput` gives each captured field only the records its own value names (locator,
  URL or title, matched on word boundaries — `citationsForValue`); a blank field, or one that
  names no record, carries none. ADR-053 verbatim coercion is unchanged.
- `apps/api/src/container.ts` wires the worker, the session event bus, the MCP client stack and
  the audit logger (the job row carries the actor id).

### 4.9 Progress event and chat indicator

- `SessionToolProgressEvent` (ADR-062 §4) joins `SessionEvent` and `KNOWN_EVENT_TYPES`;
  `parseSessionNotifyPayload` validates its fields. Not durable.
- `chats/[sessionId]/_content.tsx` listens for `tool.progress` and keeps the latest running
  event per `callId`, dropping it on `done` or when no event arrives for 15 s.
- New `ToolProgressLabel` beside `TypingIndicator`: `Calling Legislation search…`, then
  `Calling Legislation search… page 2`, and once 5 s have passed
  `Calling Legislation search… page 2 · 15s`. Pure formatting lives in
  `tool-progress-label-model.ts`.
- While the session has a pending execution on its current node and no turn is streaming, the
  feed shows the agent mark, the dots and the label, falling back to `Calling <node name>…`
  until the first event arrives.

### 4.10 Admin MCP server screen and router

- Router `mcp-server.ts`: `dataClassification` enum replaces `communicatesExternally`; new
  `callTimeoutMs`, `bearerToken` (write-only), `customHeaders` (write-only); new procedures
  `refreshTools`, `listTools` (cached, with settings) and `updateToolSettings`. Admin-only, as
  today.
- `_content.tsx`: a classification select with one-line explanations; a timeout input in
  seconds; a password-style token field and a header-name/value list that show "saved" and never
  echo values; a per-server **Tools** panel listing cached tools (title, name, last synced) with
  **Refresh tools** and an editor for each tool's pagination, status mapping and citation
  mapping.

### 4.11 Flow editor

- `mcp-picker-modal.tsx` / `node-config-modal-mcp.tsx` read tools from the cache with title and
  `inputSchema`. When a tool is chosen and the node has no request fields yet, request fields are
  pre-filled from the schema's `properties` (key, label from `title` ?? key, description,
  `required`), via a pure `requestFieldsFromInputSchema` in `apps/web/src/components/canvas/`.
  The modal shows the tool's parameters (name, type, required, description).
- Conversational step tool pickers list `public-read` servers' tools alongside `internal` ones,
  with a "Public data" badge.

### 4.12 Mocks (`mocks/mcp-tools/`)

- `public-data.mjs` registers tools that return `structuredContent`
  `{ status, caveats, items: [{ id, title, url, published_at, summary }], next_cursor }`:
  - `search_legislation` — 12 sample acts over 3 pages (`cursor` argument);
  - `search_tenders` — 2 pages, **20 s per page**;
  - `get_weather_warnings` — `status: "source_unavailable"`, empty items;
  - `search_gazette` — `status: "no_data"`, empty items, a caveat;
  - `get_statistics_release` — one page with `resource_link` blocks and a caveat about
    provisional figures.
- Mounted at `/mcp/public-data` (stateful Streamable HTTP) and `/mcp/stateless` (stateless:
  a fresh transport per request, `sessionIdGenerator: undefined`).
- There is no MCP seed today. The header comment of `public-data.mjs` lists the URLs and the
  per-tool settings (pagination, status mapping, citation mapping) to enter on the admin screen,
  so a local stack can exercise every path.

## 5. Database

One generated migration (`packages/adapters/drizzle/0055_*.sql`):

| Table | Change |
|---|---|
| `admin_mcp_servers` | add `data_classification text not null default 'internal'` (enum `internal`/`public-read`/`external-write`); backfill `'external-write'` where `communicates_externally`; drop `communicates_externally`; add `call_timeout_ms integer not null default 30000`; add `credential_ciphertext text`, `custom_headers_ciphertext text`; drop `credential_ref` |
| `admin_mcp_tools` | add `title text`, `pagination_config jsonb`, `status_config jsonb`, `citation_config jsonb` |
| `job_mcp_calls` (new) | `id`, `session_id` → `app_sessions` (cascade), `flow_id`, `node_id`, `correlation_id`, `server_id` → `admin_mcp_servers` (cascade), `tool_name`, `arguments jsonb`, `actor_id` → `core_users` (set null), `status text` (`pending`/`running`/`succeeded`/`failed`), `attempts integer default 0`, `last_error text`, `claimed_at`, `finished_at`, `created_at`, `updated_at`; index on `(status, created_at)` |

The backfill is hand-added to the generated SQL before the drop, so the classification is carried
across. The SQL declares:

```sql
-- data-impact: destructive, approved — communicates_externally is carried into data_classification before it is dropped; credential_ref is dropped and MCP_CRED_* secrets must be re-entered as encrypted credentials (ADR-062 §8)
```

`app_session_step_outputs.fields` and `app_session_messages.ai_payload` are jsonb; the new
`citations` members need no migration.

## 6. Acceptance criteria

1. A server saved as `public-read` appears in the flow editor's MCP picker and in a
   conversational step's tool picker; its tools run in both paths. An `external-write` server
   appears in neither and `RunMcpNode`/`ResolveStepTools` refuse it.
2. After migration, every server that had `communicates_externally = true` reads
   `external-write`, and every other server reads `internal`.
3. The client lists and calls tools on the stateless fixture (no `Mcp-Session-Id` header in any
   response) and on the stateful fixture.
4. A call on a server with `callTimeoutMs = 2000` against a tool that takes 5 s fails with a
   timeout error after about 2 s.
5. With pagination configured, `search_legislation` returns 12 items over 3 pages; with
   `maxPages = 2` it returns 8 items, `truncatedAtPageLimit: true`, and the output says so.
6. An MCP node calling `search_tenders` (40 s total) completes: the turn that reached it ends
   immediately, Send is available, the feed shows `Calling Search tenders… page 1`, then
   `page 2`, with the elapsed time updating every 5 s; the step output is saved and the session
   advances when the worker finishes.
7. In a conversational step, the typing indicator shows `Calling <tool title>…` with page and
   elapsed-time updates while the pre-pass runs.
8. `get_weather_warnings` in a node fails the step with "the source is unavailable"; in the
   pre-pass the model's context carries the source-unavailable line.
9. A reply that cites `[S2]` shows a Sources list with the S2 record title linked to its URL;
   fields captured by an MCP node from `search_legislation` carry its citations.
10. Every call (both paths, success and failure) writes one `mcp.tool.called` row in
    `core_audit_log` with the arguments sent.
11. A bearer token and custom headers saved on a server are sent on its requests, are stored
    as `enc:v1:` ciphertext, and are never returned by `mcpServer.list`/`get`. A reserved header
    name is refused.
12. A prior turn's 50,000-character tool result is re-injected whole on the next turn.
13. Choosing a tool with an input schema pre-fills the node's request fields from it.

## 7. Tests (written before implementation)

| Layer | File | Covers |
|---|---|---|
| domain | `entities/mcp-server.test.ts` (extend) | classification helpers; header-name validation |
| domain | `entities/mcp-tool-result.test.ts` (new) | `readPath`, `applyStatusMapping` (all four kinds, unmapped value, confidences), `extractCitations` (records path, missing fields, non-http URL dropped, resource links) |
| domain | `entities/session-event.test.ts` (extend) | `tool.progress` parse/reject, not durable |
| domain | `entities/tool-citation.test.ts` (new) | marker numbering and `resolveCitedSources` |
| application | `use-cases/mcp/mcp.test.ts` (extend) | classification in `ResolveStepTools`; register/update secrets and validation; `RefreshMcpTools`; `UpdateMcpToolSettings` |
| application | `use-cases/session/run-mcp-node.test.ts` (rewrite affected cases) | enqueues and returns pending; refuses `external-write`; enqueue failure clears pending; verbatim-only checks unchanged |
| application | `use-cases/mcp/execute-queued-mcp-calls.test.ts` (new) | success applies result with citations; source-unavailable fails; error/timeout fails and clears; server disabled/reclassified while queued; stale running rows failed; progress emitted |
| application | `use-cases/session/apply-auto-node-result.test.ts` (extend) | citations attached to captured fields |
| adapters | `mcp/mcp-sdk-client.test.ts` (new, replaces `ai-sdk-mcp-client.test.ts`) | against in-process fixtures: stateless + stateful list/call; inputSchema/title; pagination and page limit; structuredContent kept; resource links; timeout; headers sent; `isError` |
| adapters | `mcp/auditing-mcp-client.test.ts` (new) | one audit row per call, success and failure; argument cap; audit failure does not fail the call |
| adapters | `mcp/mcp-tool-prepass.test.ts` (extend) | toolset from schemas; full result kept to the ceiling; progress callback sequence including the 5 s heartbeat (fake timers) |
| adapters | `mcp/mcp-call-worker.test.ts` (new) | tick, non-overlap, job health |
| adapters | `repositories/drizzle-mcp-server-repository.test.ts`, `drizzle-mcp-tool-repository.test.ts`, `drizzle-mcp-server-secret-store.test.ts`, `drizzle-mcp-call-queue.test.ts` | mapping, settings kept across refresh, ciphertext round-trip, SKIP LOCKED claim SQL |
| adapters | migration-safety test (existing) | the new SQL's `-- data-impact:` line |
| web | `stream/mcp-turn-helpers.test.ts` (new) | numbered rendering, prompt budget marker, citation resolution onto the payload |
| web | `components/chat/tool-progress-label-model.test.ts` (new) | label text for start, page, elapsed |
| web | `components/canvas/request-fields-from-input-schema.test.ts` (new) | schema → request fields |
| mocks | `mocks/mcp-tools/public-data.test.mjs` (new) | pages, statuses, delay configurable for tests |

**No e2e.** Streaming text into the DOM is unchanged; the new indicator is driven by the session
event stream and covered by its model test and the domain event test, and the rest sits in
domain, application and adapter tests (`docs/guides/e2e-test-policy.md` — none of the six groups
applies).

## 8. Risks

- **Re-entering secrets.** Servers using `MCP_CRED_*` stop authenticating until an admin
  re-enters the token. Release notes call it out.
- **Async MCP node.** Results now arrive after the turn. The chat state must clearly show
  waiting; a worker that is not running leaves the step waiting until `failStale` would have
  run — `apps/api` is already required for extraction and schedules.
- **Client swap.** Replacing the AI SDK client touches both MCP paths. The fixtures cover SSE
  and Streamable HTTP, stateful and stateless.
- **Prompt growth.** Whole results are re-injected; the 60,000-character budget caps the
  prompt, with an explicit omission marker.
- **Audit volume.** One row per call on the hash-chained log; paginated calls still write one
  row.
- **Stateless 2026 servers** cannot connect until the SDK supports them.

## 9. ADR

ADR-062 records the decisions. The MCP decisions cited in code as "ADR-032" have no ADR file
(ADR-049 notes the same gap), so ADR-062 is the first written MCP ADR; there is no file to
amend. Comments in code this phase touches cite ADR-062.

## 10. Approved change summary

Approved on 2026-10-17 with notes (tool-progress label with 5 s updates; mocks with sample data,
multiple pages and a 20 s tool), and three later decisions: switch to the MCP SDK `Client`
(stateless 2026-07-28 out of scope); field citations on `StepOutputField` rather than ADR-053's
`FieldSourceRef`; queued node calls via a `job_mcp_calls` worker in `apps/api`.

- **Classification:** `internal | public-read | external-write` replaces `communicatesExternally`;
  `public-read` is offered to authors and runs in flows.
- **Calls:** MCP node calls queued to a worker with an admin-set timeout; the turn is released.
- **Results:** pagination, `structuredContent` and links kept; nothing cut without saying so.
- **Citations and status:** tool-record citations on step-output fields and chat replies; source
  status and caveats mapped to confidence.
- **Governance:** every call in `core_audit_log`; encrypted per-server credentials and custom
  headers; `admin_mcp_tools` cache drives schemas and per-tool settings.
- **Visibility:** "Calling <tool>…" progress beside the typing dots, updated per page and every 5 s.
- **Testing aids:** public-data mocks with paged, slow and empty-with-reason tools.
