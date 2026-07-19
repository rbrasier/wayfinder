# Phase — MCP Server Registry + Admin (v2.2.0)

**Status:** Implemented
**Version:** 2.2.0 (MINOR — new `admin_mcp_servers` + `admin_mcp_tools` tables)
**PRD:** flow-skills-and-mcp · **ADR:** ADR-032 (remote MCP over SSE)

> Migrated onto the alpha-2 line from the fork's original v1.53.0 phase. This is
> Phase 2a of the Flow Skills & MCP arc — the registry and admin management.
> Flow *consumption* (the mcp node + conversational tool-loop) is Phase 2b.

## Goal

Let an admin register remote (SSE) Model Context Protocol servers so flow
authors can later attach their tools — without any user ever seeing the
credentials. A connection test lists a server's tools to confirm reach and auth
before the server is used in a flow.

## Scope

- Register / list / update / enable / disable MCP servers (`/admin/mcp-servers`).
- Connection test: resolve a server and list its tools via the AI-SDK MCP client.
- Directory read surface (`listServersWithTools`) for the future flow editor.
- Domain scaffolding for consumption (the `mcp` node type, `McpNodeConfig`,
  `allowedMcpToolRefs`) lands here; the runtime that uses it arrives in Phase 2b.

## Design

- **domain** — `McpServer` / `McpTool` / `McpToolRef` / `McpServerWithTools`
  entities; `IMcpClient`, `IMcpServerRepository`, `IMcpServerDirectory` ports;
  `FlowNodeType` gains `mcp`; `McpNodeConfig` + `ConversationalNodeConfig
  .allowedMcpToolRefs`.
- **application** — `RegisterMcpServer` / `UpdateMcpServer` / `ListMcpServers` /
  `EnableMcpServer` / `DisableMcpServer` / `TestMcpServer` /
  `ListMcpServersWithTools` (http(s)-URL validation, trimmed inputs).
- **adapters** — `AiSdkMcpClient` (Vercel AI SDK `experimental_createMCPClient`,
  SSE transport, per-call open/close, bearer token resolved from an env var named
  by `credentialRef`); `McpServerDirectory`; `DrizzleMcpServerRepository`;
  `admin_mcp_servers` + `admin_mcp_tools` tables.
- **web** — `mcpServer` tRPC router; container wiring; `/admin/mcp-servers` admin
  page; sidebar entry.

## Security

- The secret value never leaves the adapter layer. `credentialRef` names an
  environment variable; the token is read there and attached as a bearer header
  — it is never stored in the DB nor returned to a client (ADR-032).

## Out of scope (Phase 2b / 3)

- The mcp action node runtime and the conversational tool-loop (Phase 2b).
- `context`/`actions` server kinds and `businessSelectable` (Phase 3 flag-split).
- Streamable-HTTP transport (Phase 3).

## Version

MINOR: `2.1.0 → 2.2.0` (two new admin tables, migration `0030`).
