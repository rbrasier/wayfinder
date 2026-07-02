# Phase — MCP Integration

> Phase 2 of the Flow Skills & MCP PRD. Builds on Phase 1 (v1.52.0 skills).

- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/032-mcp-integration-and-tool-calling.adr.md`
- **Target version**: 1.54.0 (MINOR — new feature + new tables). Both sub-phases
  ship in v1.54.0: the line's own v1.53.0 was taken by the pre-generation
  evaluation gate when this branch merged `main`, so the MCP work consolidated up.

## Status

- **Phase 2a — DONE (v1.54.0):** foundation + admin registry. Sub-components 1–4
  plus the `/admin/mcp-servers` admin page.
- **Phase 2b — DONE (v1.54.0):** flow consumption. The deterministic `mcp` node
  (canvas node type + editor + `RunMcpNode` dispatch, applied via the shared
  auto-node-result path) and the conversational tool-loop (a non-streaming
  `generateText` pre-pass bounded by `allowedMcpToolRefs`, folded into the step
  context — ADR-032). Per the ADR testing strategy, the deterministic node, the
  deny-by-default tool selection, and tool resolution are unit-tested with fakes;
  live LLM-over-MCP end-to-end behaviour is a staging smoke test.

## Scope

Admin-registered remote (SSE) MCP servers, usable two ways (ADR-032):

1. A deterministic `mcp` node that calls one tool with mapped inputs and captures
   the result as step output (reuses the `INodeExecutor` + ADR-020 path).
2. Tool-calling inside conversational steps, bounded by a step's
   `allowedMcpToolRefs` (pre-filled from a skill's `allowedTools`, ADR-031).

## Sub-components (build in order)

1. **Domain** — `McpServer`/`NewMcpServer`/`McpServerUpdate`/`McpTool`/`McpToolRef`
   entities; `IMcpClient`, `IMcpServerRepository`, `IMcpServerDirectory` ports.
   Add `"mcp"` to `FlowNodeType` + `McpNodeConfig`; add
   `allowedMcpToolRefs?: McpToolRef[]` to `ConversationalNodeConfig`.
2. **Adapter** — `admin_mcp_servers` (+ `admin_mcp_tools` cache) schema;
   `DrizzleMcpServerRepository`; `AiSdkMcpClient` (`experimental_createMCPClient`,
   sse transport); `McpServerDirectory`; `McpNodeExecutor` in the executor registry.
3. **Application** — `RegisterMcpServer`/`UpdateMcpServer`/`ListMcpServers`/
   `DisableMcpServer`/`TestMcpServer`, `ListMcpTools`, `ResolveStepTools`.
4. **Wiring** — `mcpServer` (admin) + `mcpDirectory` tRPC routers; container
   registration; node-executor registry.
5. **UI + tool-loop** — `/admin/mcp-servers` page; `mcp` node in the canvas
   (defaults/styles/picker/editor + config mapping); allowed-tools picker in the
   conversational editor; conversational tool-loop in the agents adapter; e2e;
   version bump; move this doc; summary; `validate.sh` green.

## Security / governance (ADR-032)

- Remote SSE servers only; no local/stdio. Admin-only registration.
- Credentials stored via a referenced secret, never returned to the client.
- Conversational tool access is deny-by-default: only `allowedMcpToolRefs`.
- Tool output is untrusted external data — framed like `<reference_documents>`.

## Out of scope

- Streamable-HTTP transport (SDK 4.3.19's config supports `sse`; HTTP needs a
  custom transport — deferred).
- MCP resources/prompts/elicitation/sampling.
- Auto-deriving a tool's input schema into editor fields (authors define request
  fields manually, like the auto-node's custom fields).

## Open questions (carried from ADR-032)

- Secret store backing `credentialRef`.
- Runtime spike: confirm the AI SDK streams a tool-using turn and still yields the
  structured `{response, confidence, contextGathered}` object before relying on the
  conversational tool-loop in production.
