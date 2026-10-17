# ADR-062 — Public-Data MCP Readers: Classification, Queued Calls and Tool-Record Citations

- **Status**: Proposed (scoped by `public-data-mcp-servers.phase.md`)
- **Date**: 2026-10-17
- **Builds on**: ADR-033 *Immutable Audit Log & Legal Hold*, ADR-049 (flow export/import
  resolution of MCP references), ADR-050 (external field values), ADR-053 (field provenance and
  verbatim-only governance), ADR-060 (request-scoped audit actor context)
- **Supersedes, for MCP**: the decisions code comments cite as "ADR-032" (remote MCP over
  SSE/Streamable HTTP, the tool-loop pre-pass, the MCP node, env-var credential references).
  That number has no ADR file — ADR-049 records the same gap — so this is the first written
  MCP ADR, and it restates the parts it keeps as well as the parts it changes. Code comments
  touched by this phase cite ADR-062.

## Context

Third parties publish public government data — legislation, gazettes, statistics, tenders,
warnings — as read-only, remote MCP servers. Wayfinder's MCP support was built for a narrower
case and refuses them, in four ways that compound:

1. **Classification.** A server is classified by one boolean, `communicatesExternally`. A server
   that reads public records and a server that sends Wayfinder's records out are the same
   `true`, and `true` is refused in three places: the author directory
   (`mcp-server-directory.ts`), step tool resolution (`ResolveStepTools`) and the runtime
   backstop (`RunMcpNode`).
2. **Client.** `experimental_createMCPClient` from `ai@4.3.19` negotiates only protocol
   `2024-11-05`/`2024-10-07`, never surfaces a tool's `inputSchema`, and flattens results to
   text, discarding `structuredContent` and `resource_link` content.
3. **Time.** Every call is capped at a fixed 8 s, and the MCP node calls the tool while the
   session's turn lease is held. Public-data sources routinely take 10–30 s.
4. **Governance.** Calls are recorded only on a session message (`aiPayload.toolCalls`), cut to
   4,000 characters — and that cut copy is what later turns re-read. Nothing reaches
   `core_audit_log`. Credentials are `MCP_CRED_*` environment variables.

## Decision

### 1. Classification is a three-valued enum, and two of its values are flow-usable

```typescript
export type McpDataClassification = "internal" | "public-read" | "external-write";
export const isFlowUsableClassification = (value: McpDataClassification): boolean =>
  value !== "external-write";
```

`internal` is today's `communicatesExternally = false`. `external-write` is today's `true`, and
stays refused in all three places. `public-read` is new: a server that reads records from
outside Wayfinder and sends nothing back but the query. It is offered to authors and runs in
flows. Admin approval stays per server — classifying a server is the approval.

The boolean is **replaced**, not joined by a second boolean: two flags admit a combination
(`publicRead && communicatesExternally`) that means nothing and that every reader would have to
decide about. The migration carries every row across (`false → internal`,
`true → external-write`), so no existing server changes behaviour.

### 2. The MCP SDK `Client` replaces the AI SDK client

`@modelcontextprotocol/sdk` `Client` (1.32.1) negotiates up to protocol `2025-11-25`, surfaces
`inputSchema`, returns `structuredContent` and `resource_link` blocks, and takes a per-request
timeout and abort signal. The conversational pre-pass builds its AI SDK `ToolSet` from the
listed tools (`jsonSchema(inputSchema)`) with each tool's `execute` routed through the same
client — so both MCP paths share one call path, one timeout rule, one audit point and one
pagination implementation.

**Stateless servers** in the 2025 sense — Streamable HTTP with no `Mcp-Session-Id` — are
verified against a fixture. The stateless **2026-07-28** protocol (no `initialize` handshake)
is not implemented by any released TypeScript client (1.32.1 carries only a `DRAFT-2026-v1`
type constant; `@modelcontextprotocol/client` 2.3.1 also tops out at `2025-11-25`). It is a
documented limitation, resolved by an SDK upgrade, not by hand-written protocol code.

### 3. The MCP node's call is queued; the turn does not wait for it

`RunMcpNode` resolves the request fields (one fast model call), records the pending execution
and enqueues a `job_mcp_calls` row, then returns `pending`. The turn ends and the lease is
released. A worker in `apps/api` (built like the extraction worker: interval tick,
`FOR UPDATE SKIP LOCKED` claim, `job_registry` health) makes the call within the server's
`callTimeoutMs` and applies the result through `ApplyAutoNodeResult` — the same path an n8n
callback takes. A failure or timeout clears the pending entry and posts the step's failure
message. A `running` row older than its timeout plus a grace period is failed on the next
tick, so a worker crash cannot strand a session.

The conversational pre-pass stays inside the turn: the model's next words depend on its result.
Each of its calls is bounded by its server's `callTimeoutMs`.

### 4. Progress is an ephemeral session event

```typescript
interface SessionToolProgressEvent {
  type: "tool.progress";
  callId: string;
  toolTitle: string;
  serverLabel: string;
  page: number;
  elapsedMs: number;
  state: "running" | "done";
}
```

It is published when a call starts, when each further page is requested, every 5 s while the
call is still in flight, and once when it ends. It travels over the existing session event bus
(Postgres NOTIFY, well under the 8 KB payload limit), so the `apps/api` worker and the web chat
route publish it the same way, and every open window renders it. Like `typing`, it is never
persisted and does not advance the replay cursor.

### 5. Pagination, source status and citations are admin-configured per tool

MCP has no standard for tool-level cursors, for "why is this empty" or for which part of a
result is a record. Guessing field names would work for some servers and silently fail for the
rest, so each is configured per tool on the `admin_mcp_tools` row the admin already reviews:

- **Pagination** — cursor argument, next-cursor path, items path, page limit. A result that
  stops at the page limit says so; it is never presented as complete.
- **Source status** — status path, a map from the source's own values to
  `ok | no-data | source-unavailable | upstream-gap`, and a caveats path. Each kind maps to a
  confidence (`ok` 1, `no-data` 1, `upstream-gap` 0.5, `source-unavailable` 0). The kind and
  caveats are rendered beside the result, so an unavailable source is never read as "nothing
  found".
- **Citations** — records path and the locator, title, URL and timestamp fields. MCP-native
  `resource_link` blocks become citations without configuration.

A tool with no configuration behaves as today: one page, no status, citations only from
`resource_link` blocks.

### 6. Citations live on the session step output and the assistant turn — not on `FieldSourceRef`

ADR-053's `FieldSourceRef` belongs to `ExtractionFieldResult`, which only batch document
extraction produces. No MCP result reaches that path, so a tool-record variant there would have
no producer. Tool output becomes fields through the MCP node → `ApplyAutoNodeResult` →
`app_session_step_outputs`. So:

```typescript
export interface ToolRecordCitation {
  serverId: string;
  serverLabel: string;
  toolName: string;
  locator: string;
  title: string | null;
  url: string | null; // http(s) only
  recordedAt: string | null;
}
```

is added as `StepOutputField.citations?` and `AiTurnPayload.citations?`. Both are additive
members of existing jsonb columns, so no migration. In chat, the records in `<tool_results>` are
numbered `[S1]…[Sn]`, the model is asked to cite with those markers, and the markers in the
persisted reply resolve to the turn's `citations`. ADR-053's extraction provenance is unchanged.

### 7. Every call is audited, with the full result kept on the turn

Each call writes one `core_audit_log` row — `action: "mcp.tool.called"`, `resourceType:
"mcp_server"` — whose metadata holds what was sent (the arguments), the tool, pages fetched,
result size, source status, outcome, duration, and the session, flow and node. The actor is the
session user, passed explicitly (the worker has no request scope).

`McpToolCallRecord.result` keeps the full result up to a hard ceiling of 200,000 characters, and
marks `truncated` when the ceiling is hit; the prompt notes the omission. Truncation can still
happen, but never silently.

### 8. Credentials and headers are encrypted per server

`admin_mcp_servers` gains `credential_ciphertext` and `custom_headers_ciphertext`, encrypted with
the existing `SettingsEncryptionService` (AES-256-GCM, `SETTINGS_ENCRYPTION_KEY`). Values are
write-only: the domain `McpServer` carries only `hasCredential` and `customHeaderNames`, and the
secrets are decrypted inside the adapter that opens the connection. `credential_ref` and the
`MCP_CRED_*` environment namespace are removed. Header names that would let an admin break the
transport (`Host`, `Content-Length`, `Content-Type`, `Accept`, `Mcp-Session-Id`,
`Mcp-Protocol-Version`, `Last-Event-ID`) are refused, and `Authorization` is refused as a custom
header when a bearer token is also set.

## Consequences

- An existing server that authenticates with an `MCP_CRED_*` variable stops sending its token
  until an admin re-enters it on the MCP server screen. Called out in the release notes.
- An MCP node's result now arrives after the turn that started it, so the chat shows a
  "Calling …" state on the step instead of holding Send. Flows that relied on the step having
  finished within the same request (none in the seed data) see the next step one tick later.
- The pre-pass still makes the turn's author wait for a slow source; it no longer blocks
  anyone else beyond what the turn already did, and the wait is labelled.
- `apps/api` must be running for MCP nodes to complete — as it already must for extraction runs
  and scheduled flows.
- The stateless 2026-07-28 protocol stays unsupported until the MCP SDK ships it.
