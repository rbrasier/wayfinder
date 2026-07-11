# Phase — MCP Flow Consumption + Tool-Loop (v2.3.0)

**Status:** Implemented
**Version:** 2.3.0 (MINOR — new feature, no new tables)
**PRD:** flow-skills-and-mcp · **ADR:** ADR-032

> Migrated onto the alpha-2 line from the fork's original v1.54.0 phase. This is
> Phase 2b of the Flow Skills & MCP arc — flow *consumption* of the registry
> built in Phase 2a.

## Goal

Make registered MCP servers usable inside flows, two ways:

1. **Deterministic MCP action node** — a new `mcp` node type that calls one tool
   on one server synchronously, mirroring the auto (n8n) node: resolve request
   fields → record a pending execution → call the tool → persist the result via
   the shared auto-node-result path.
2. **Conversational tool-loop** — a conversational step may allow specific MCP
   tools (`allowedMcpToolRefs`, deny-by-default). Before the streaming turn, a
   non-streaming pre-pass lets the model call those tools and folds the gathered
   results into the step context as a `<tool_results>` block.

## Design

- **application** — `RunMcpNode` (deterministic call, mirrors `RunAutoNode`);
  `ResolveStepTools` (resolves `allowedMcpToolRefs` to active servers/tools,
  drops refs to missing/disabled servers).
- **adapters** — `McpToolPrepass` (Vercel AI SDK `generateText` tool-loop over
  the allowed toolset; `selectAllowedTools` enforces deny-by-default and is
  unit-tested).
- **web** — `dispatchMcpNode` + `runMcpToolPrepass` in the chat turn helpers;
  `runMcpToolPrepass` called in the stream route before `buildSystemPrompt`;
  `dispatchMcpNode` hooked into `applyAdvanceSideEffects` for `mcp` nodes;
  container wiring; canvas `McpNode`, node picker "MCP Tool" option, node
  config editor (server/tool/request-response fields + the conversational
  "MCP tools" allow-list), save/load in both flow editors.

## Security

- Deny-by-default: a conversational step only ever offers tools explicitly listed
  in `allowedMcpToolRefs`; `selectAllowedTools` filters the assembled toolset to
  that list. A tool problem never blocks the turn (the pre-pass fails soft).

## Correctness note (improved over the fork)

- The fork's flow-editor did not map the `mcpNode` canvas type back to the `mcp`
  config type when re-opening a saved MCP node, so editing one silently fell back
  to conversational. This migration adds that mapping in both editors so MCP
  nodes round-trip correctly.

## Version

MINOR: `2.2.0 → 2.3.0` (new feature; no schema change — the `mcp` node type and
its tables landed in Phase 2a).
