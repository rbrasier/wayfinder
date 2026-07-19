# Phase — MCP/Skills Power-User Flags + Streamable-HTTP Transport (v2.4.0)

**Status:** Implemented
**Version:** 2.4.0 (MINOR — new feature; no new tables)
**PRD:** flow-skills-and-mcp · **ADR:** ADR-022 (feature flags), ADR-032 §1 (transport)

> Scoped slice of the fork's `f90e978` + `343a41f`. Delivers exactly the two
> things requested — gate MCP/Skills behind power-user flags, and add
> streamable-HTTP transport. The larger `f90e978` Context/Actions
> prepare/confirm redesign (server `kind`, `businessSelectable`, flow-level
> context servers, `prepare-mcp-node`/`confirm-mcp-node`) is **not** included —
> it is a separate architectural change, tracked for a later phase.

## Goal

1. **Power-user gating** — MCP and Skills become power-user-scoped feature flags
   (`mcp`, `skills`), joining `auto_node`/`scheduled_node`. Admins pass via the
   wildcard; regular users only see the in-flow Skills/MCP-tools sections and the
   "MCP Tool" node when their organisation has enabled the flag.
2. **Streamable-HTTP transport** — MCP servers can use the newer MCP
   streamable-HTTP endpoint in addition to SSE.

## Design

- **flags** — `POWER_USER_SCOPED_FLAGS += "mcp", "skills"` (seed-roles). The flow
  editors query `featureFlag.isEnabledForMe` for `mcp`/`skills` and pass them to
  the node-type picker (`mcpNodeEnabled`) and the config modal
  (`skillsEnabled`/`mcpEnabled`, which gate the conversational Skills and
  MCP-tools sections; both default off).
- **transport** — `McpTransport` widened to `"sse" | "streamable-http"`;
  `admin_mcp_servers.transport` enum widened (text column — no SQL migration).
  `buildMcpTransport` (exported from the AI-SDK client) returns the SSE shorthand
  or a `StreamableHTTPClientTransport` (`@modelcontextprotocol/sdk`); the
  tool-loop pre-pass reuses it. `RegisterMcpServer` + the tRPC router + the admin
  UI accept and display the transport.

## Out of scope (deferred — the rest of f90e978)

- Server `kind` (context/actions), `businessSelectable`, flow-level context
  server selection, and the `prepare-mcp-node`/`confirm-mcp-node` operator
  confirmation flow. These reshape the MCP consumption model built in Phase 2b
  and warrant their own phase + review.

## Version

MINOR: `2.3.0 → 2.4.0`. New dependency: `@modelcontextprotocol/sdk` (adapters).
No schema migration (both enum widenings are TS-level text columns).
