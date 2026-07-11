# Implementation Summary — MCP/Skills Flags + Streamable-HTTP (v2.4.0)

Scoped port of `f90e978` + `343a41f`: power-user flag gating for MCP/Skills and
streamable-HTTP transport. The larger Context/Actions prepare/confirm redesign
from `f90e978` is intentionally deferred (see phase doc).

## What was built

- **Flags:** `mcp` and `skills` added to `POWER_USER_SCOPED_FLAGS`. Both flow
  editors gate the "MCP Tool" node (picker `mcpNodeEnabled`) and the
  conversational Skills / MCP-tools sections (modal `skillsEnabled`/`mcpEnabled`,
  default off) behind `featureFlag.isEnabledForMe`.
- **Transport:** `McpTransport = "sse" | "streamable-http"`; `buildMcpTransport`
  branches to `StreamableHTTPClientTransport` for streamable-http servers and is
  reused by the tool-loop pre-pass. `RegisterMcpServer`, the tRPC router, and the
  admin MCP-servers page (Transport selector + column) all handle it.

## Files created

- `packages/adapters/src/mcp/ai-sdk-mcp-client.test.ts`
- `tests/e2e/phase-mcp-flags-and-transport.spec.ts`
- `docs/development/implemented/alpha-2/v2.4.0/{phase-mcp-flags-and-transport.phase.md,_implementation-summary.md}`

## Files modified

- domain: `entities/mcp-server.ts` (transport union)
- adapters: `db/schema/admin.ts` (transport enum), `mcp/ai-sdk-mcp-client.ts`
  (`buildMcpTransport`/`resolveAuthHeaders`), `mcp/mcp-tool-prepass.ts` (reuse),
  `auth/seed-roles.ts` (+ test), `package.json` (SDK dep)
- application: `use-cases/mcp/mcp.ts` (RegisterMcpServer transport)
- web: `server/routers/mcp-server.ts`, `app/(admin)/admin/mcp-servers/_content.tsx`
  (transport selector + column), `components/canvas/node-config-modal.tsx`
  (skillsEnabled/mcpEnabled gating), both flow-editor `_content.tsx` (flag queries
  + props)

## Dependency

- `@modelcontextprotocol/sdk@^1.12.0` added to `packages/adapters` (the only
  package that imports it; web reaches it transitively via the adapters
  workspace dep). Resolved to v1.29.0 in the store and recorded in
  `pnpm-lock.yaml` under the adapters importer, so CI's frozen install matches.
  `StreamableHTTPClientTransport` export verified in node_modules.

## Migrations

- None. Both the `transport` and the earlier node-type enum widenings are
  TS-level text columns — no DB constraint change.

## Tests

- Unit (green): `buildMcpTransport` (3 — SSE shorthand, streamable-http instance,
  bearer header), seed-roles (mcp/skills power-user assertions), MCP use-case (11).
- e2e: `phase-mcp-flags-and-transport.spec.ts` (register streamable-HTTP server).
  Requires a running stack; not executed here.

## Known limitations / deferred

- Full gated-user e2e (a user without the flag) needs flag fixtures — deferred;
  the seed-roles unit test covers the flag→role wiring.
- Context/Actions server kinds, `businessSelectable`, flow-level context servers,
  and the prepare/confirm operator-gating flow remain deferred to a later phase.
- `./validate.sh` typecheck/lint/tests/coverage + e2e not runnable in the sandbox
  (unlinked pnpm bins; no infra). Web app typechecks clean; a11y strict passes.
