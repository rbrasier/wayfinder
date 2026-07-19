# Implementation Summary — MCP Server Registry (v2.2.0)

Migrated the fork's MCP registry (originally v1.53.0, Phase 2a) onto the alpha-2
base. Admins can register remote SSE MCP servers, test connectivity, and
enable/disable them; credentials are referenced by env-var name and never stored
or returned (ADR-032). Flow consumption of these servers lands in Phase 2b.

## What was built

- `/admin/mcp-servers` — register / list / test / disable / enable.
- `AiSdkMcpClient` over the Vercel AI SDK MCP client (SSE, per-call open/close).
- Server directory read surface for the future flow editor.
- Domain scaffolding for consumption: `mcp` node type, `McpNodeConfig`,
  `ConversationalNodeConfig.allowedMcpToolRefs`.

## Files created

- `packages/domain/src/entities/mcp-server.ts`
- `packages/domain/src/ports/{mcp-client,mcp-server-directory,mcp-server-repository}.ts`
- `packages/application/src/use-cases/mcp/{mcp.ts,mcp.test.ts,index.ts}`
- `packages/adapters/src/mcp/{ai-sdk-mcp-client.ts,mcp-server-directory.ts,index.ts}`
- `packages/adapters/src/repositories/drizzle-mcp-server-repository.ts`
- `packages/adapters/drizzle/0030_nappy_mysterio.sql`
- `apps/web/src/server/routers/mcp-server.ts`
- `apps/web/src/app/(admin)/admin/mcp-servers/{page.tsx,_content.tsx}`
- `tests/e2e/phase-mcp-integration.spec.ts`
- `docs/development/implemented/alpha-2/v2.2.0/{phase-mcp-registry.phase.md,_implementation-summary.md}`

## Files modified

- domain: `entities/index.ts`, `ports/index.ts`, `entities/flow-node.ts`
  (`mcp` type, `McpNodeConfig`, `allowedMcpToolRefs`)
- adapters: `db/schema/admin.ts` (2 tables), `db/schema/wayfinder.ts` (node-type
  enum), `index.ts`, `repositories/index.ts`
- application: `use-cases/index.ts`
- web: `server/router.ts`, `lib/container.ts`, `components/sidebar.tsx`,
  both flow-editor `_content.tsx` files (`RawNode` type union)

## Migrations

- `0030_nappy_mysterio.sql` — `admin_mcp_servers` + `admin_mcp_tools`
  (fk cascade, unique server_id+name). The `mcp` node-type is a TS-level enum
  (text column), so it needs no SQL change. Run `pnpm db:migrate`.

## Tests

- Unit (green in this session): 8 MCP use-case tests (register/update/validate,
  enable/disable/list, connection-test success/failure/not-found).
- e2e: `tests/e2e/phase-mcp-integration.spec.ts` — register / validation-error /
  disable. Requires a running stack; not executed in the migration sandbox.

## Known limitations / deferred

- `input_schema` is stored on `admin_mcp_tools` but tool discovery caching is not
  yet wired (the directory lists live each call); acceptable at registry scale.
- Server `kind` (context/actions) and `businessSelectable` are deferred to the
  Phase 3 flag-split; every server is admin-managed here.
- Streamable-HTTP transport is deferred to Phase 3; only SSE is supported.
- Full `./validate.sh` / e2e not runnable in the sandbox (no infra; unlinked
  pnpm bins). Web app typechecks clean apart from the pre-existing `.css` noise.
