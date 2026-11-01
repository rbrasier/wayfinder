# Implementation Summary — Read-Only Public-Data MCP Servers in Flows (v0.40.0)

- **Version**: 0.39.0 → **0.40.0** (MINOR — schema change)
- **Phase doc**: `public-data-mcp-servers.phase.md` (this folder)
- **ADRs**: ADR-062 (new; the first written MCP ADR — the "ADR-032" code comments cited for MCP
  has no file)
- **Issue**: [#333](https://github.com/rbrasier/wayfinder/issues/333)

## What was built

An admin now classifies each MCP server as an **internal utility**, a **public-data reader** or a
server that **sends records out**. The first two are offered to flow authors and run in flows; the
third stays refused everywhere the old `communicatesExternally = true` was refused (author
directory, step tool resolution, MCP node runtime, flow import). Existing servers are carried
across by the migration, so none changes behaviour.

The AI SDK v4 MCP client is replaced by the MCP SDK `Client`, which works with servers that keep no
session. Each server has an admin-set call timeout (1–120 s, default 30 s). Each tool can have
pagination (cursor argument, next-cursor path, items path, page limit), a source-status mapping
(status values → no data / source unavailable / upstream gap, with caveats) and a citation mapping
(records path, locator, title, URL, timestamp). Results keep their structured content and resource
links. A result cut at the page limit or at the 200,000-character record ceiling says so.

An MCP node's call is no longer made inside the turn: the turn records the pending execution,
queues the call in `job_mcp_calls` and ends. A worker in `apps/api` (and a Lambda handler for
Lambda installs) runs up to ten calls at once, then applies each result through the same path an
n8n callback takes. While any tool runs, in either the conversational pre-pass or a queued node,
the chat shows **"Calling *Search tenders*… page 2 · 15s"** beside the typing dots. It updates
when each page is requested and every 5 seconds while the call is still waiting.

Replies cite source records: the records in `<tool_results>` are numbered `[S1]…[Sn]`, the model is
asked to cite them, and a reply's markers become a **Sources** list under the message, with links.
Each field an MCP node captures carries only the records its own value names (by locator, URL or
title); a blank field, or one that names no record, carries none. Every tool call writes one
`mcp.tool.called` row to `core_audit_log` with the arguments sent. Bearer tokens and custom
headers are stored encrypted per server and never shown again. The `admin_mcp_tools` cache now
drives tool titles, input schemas (the editor pre-fills request fields from them) and the per-tool
settings.

## Files created

- `docs/development/adr/062-public-data-mcp-readers.adr.md`
- Domain: `entities/mcp-tool-result.ts`, `entities/tool-citation.ts`, `entities/tool-progress.ts`,
  `entities/mcp-call-job.ts`, ports `mcp-server-secret-store.ts`, `mcp-tool-repository.ts`,
  `mcp-call-queue.ts` (each entity with a test)
- Application: `use-cases/mcp/execute-queued-mcp-calls.ts` (+ test)
- Adapters: `mcp/mcp-sdk-client.ts`, `mcp/auditing-mcp-client.ts`, `mcp/mcp-call-worker.ts`,
  `mcp/mcp-fixture-server.test-support.ts` (stateless, stateful and SSE fixtures),
  repositories `drizzle-mcp-server-secret-store.ts`, `drizzle-mcp-tool-repository.ts`,
  `drizzle-mcp-call-queue.ts` (each with a test), `mcp/mcp-server-directory.test.ts`
- Migrations: `drizzle/0055_mcp_public_data_readers.sql`, `drizzle/0056_mcp_drop_legacy_credentials.sql`
  (+ snapshots and journal)
- Web: `components/admin/mcp-server-form-model.ts` (+ test), `components/admin/mcp-tools-panel.tsx`,
  `components/chat/tool-progress-label-model.ts` (+ test), `components/chat/cited-sources-model.ts`
  (+ test), `components/chat/cited-sources.tsx`, `components/canvas/request-fields-from-input-schema.ts`
  (+ test), `app/api/chat/[sessionId]/stream/mcp-turn-helpers.test.ts`
- Lambda: `deploy/lambda/handlers/tick-mcp-calls.ts`
- Mocks: `mocks/mcp-tools/public-data.mjs` (+ test), `mocks/mcp-tools/public-data-http.mjs`,
  `mocks/mcp-tools/stateful-http.mjs` (+ test)

## Files modified

- Domain: `entities/mcp-server.ts` (classification, timeout, secrets types, header validation;
  `credentialRef`/`MCP_CRED_*` removed), `entities/session-event.ts` (`tool.progress`),
  `entities/session-step-output.ts` and `entities/session-message.ts` (citations),
  `entities/flow-import-resolve.ts`, `ports/mcp-client.ts`
- Application: `use-cases/mcp/mcp.ts` (register/update secrets, `RefreshMcpTools`, `ListMcpTools`,
  `UpdateMcpToolSettings`, cache refresh on test), `use-cases/session/run-mcp-node.ts` (queues),
  `use-cases/session/apply-auto-node-result.ts` (citations), `use-cases/flow/inspect-flow-import.ts`
- Adapters: `db/schema/admin.ts`, `db/schema/job.ts`, `mcp/mcp-tool-prepass.ts` (rewritten onto the
  shared client), `mcp/mcp-server-directory.ts` (reads the cache), `repositories/drizzle-mcp-server-repository.ts`
- `ai-sdk-mcp-client.ts` and its test are deleted
- Web: `server/routers/mcp-server.ts`, `lib/container.ts`, `lib/container-skills-mcp.ts`,
  `app/(admin)/admin/mcp-servers/_content.tsx`, `app/api/chat/[sessionId]/stream/{route,execute-turn,mcp-turn-helpers}.ts`,
  `app/(user)/chats/[sessionId]/_content.tsx`, `components/chat/message-feed.tsx`,
  `components/canvas/{node-config-modal-mcp,mcp-picker-modal}.tsx`
- API: `apps/api/src/{container,env,workers}.ts`; Lambda stack and tests; `.env.example`
- Mocks: `mocks/server.mjs`, `mocks/mcp-tools/streamable-http.mjs`

## Migrations

- `0055_mcp_public_data_readers.sql`:
  - **What it does:** adds `data_classification`, `call_timeout_ms` and the two ciphertext columns to `admin_mcp_servers`, adds `title` and three settings columns to `admin_mcp_tools`, and creates `job_mcp_calls`. A hand-added `UPDATE` carries `communicates_externally = true` into `'external-write'`.
  - **Data impact:** `-- data-impact: preserved — …`
- `0056_mcp_drop_legacy_credentials.sql`:
  - **What it does:** drops `credential_ref` and `communicates_externally`.
  - **Data impact:** `-- data-impact: destructive, approved — … MCP_CRED_* secrets must be re-entered …`

## Tests

- Written before each implementation, at the layer that owns the logic: domain, application,
  adapters (including real stateless, stateful and SSE MCP servers on ephemeral ports), web models,
  Lambda stack and handler, and mocks.
- `./validate.sh` passes (27 checks).
- Workspace totals: domain 1,240 tests, application 1,403, adapters 1,220, web 1,379, api 28,
  mocks 156. `deploy/lambda`: 19 unit tests, plus one integration case added for CI's Postgres job.
- A live smoke run against the mocks server checked both public-data endpoints. The real
  `McpSdkClient` got three pages and 12 legislation citations, 8 tender citations, `source-unavailable`
  and `no-data` statuses, and 2 resource-link citations. It also showed the existing internal
  `/mcp` and `/mcp/sse` mocks answering repeated clients.
- **No e2e** (none of the `e2e-test-policy.md` groups applies). The behaviour is covered at the
  domain, application, adapter and component-model layers. The new chat indicator is driven by the
  session event stream, not new streaming into the DOM.

## Deviations from the approved summary

1. **Two migrations, not one.** `drizzle-kit generate` prompts interactively when a table drops a
   column and adds one in the same change. 0055 adds the columns and carries the data across;
   0056 drops the old columns. Both are generated.
2. **Field citations live on `StepOutputField`**, not on ADR-053's `FieldSourceRef`: `FieldSourceRef`
   belongs to extraction records, which no MCP result reaches. Agreed during the build. ADR-053 is
   unchanged.
3. **MCP SDK `Client` replaces the AI SDK client.** No released TypeScript client implements the
   stateless 2026-07-28 protocol, so that protocol stays a documented limitation. Agreed during the
   build.
4. **Time caps.**
   - Each paginated call is also capped at 10 minutes in total (`MAX_MCP_CALL_TOTAL_MS`).
   - A queued call left `running` for longer than that plus 60 s is failed.
   - Planned instead: the stale cut-off was to be per server (`callTimeoutMs` + 60 s).
5. **Concurrency.**
   - The worker runs up to `MCP_CALL_MAX_IN_FLIGHT` (default 10) calls at once, so one slow source
     never holds up the next call.
   - New env vars: `MCP_CALL_WORKER_ENABLED`, `MCP_CALL_TICK_MS`, `MCP_CALL_MAX_IN_FLIGHT`.
6. **Lambda.** Lambda installs get a `tick-mcp-calls` handler on a one-minute EventBridge rule (11-minute
   timeout) that drains the calls it starts. Without it, MCP steps would never complete on Lambda.
7. **Mocks.** The existing stateful Streamable HTTP mock (`/mcp`) held one transport for the whole process
   and refused every client after the first. It now opens a session per client, like the new
   `/mcp/public-data`.
8. **Copy.** The queued node's chat message reads "Waiting on the source for step: <name>.", and the
   live label carries the tool title.
9. **Unmapped status values.** A status value an admin did not map reads as `ok`.

## Known limitations

- **Re-entering secrets.** Servers that authenticated with an `MCP_CRED_*` variable need their
  token re-entered on the MCP server screen after upgrading.
- **Pre-pass wait.** The conversational pre-pass still makes the person who sent the message wait
  for the source; the wait is labelled.
- **Lambda start delay.** On Lambda, a queued call can wait up to a minute to start (EventBridge's
  floor).
- **Argument names.** Request-field pre-fill round-trips `snake_case` argument names exactly. A
  camelCase argument cannot be expressed as a field key, which was already the case.
- **Stateless 2026-07-28 servers** cannot connect until the MCP SDK ships that protocol.
- **Not checked in a browser.** The admin screen and chat indicator were not run in a browser in
  this build (no running stack). They are covered by their model tests and typecheck, and by CI's
  e2e smoke run.
