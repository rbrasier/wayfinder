# Implementation Summary — MCP Flow Consumption (v2.3.0)

Migrated the fork's MCP flow consumption (originally v1.54.0, Phase 2b) onto the
alpha-2 base. Registered MCP servers are now usable in flows as a deterministic
`mcp` action node and as a conversational tool-loop (ADR-032).

## What was built

- `RunMcpNode` — deterministic single-tool call, mirrors `RunAutoNode`.
- `ResolveStepTools` — resolves a step's `allowedMcpToolRefs` to active
  servers/tools (deny-by-default; missing/disabled servers dropped).
- `McpToolPrepass` — non-streaming AI-SDK tool-loop; `selectAllowedTools`
  enforces the allow-list (unit-tested).
- Chat turn helpers: `dispatchMcpNode` (mcp node runtime) and
  `runMcpToolPrepass` (conversational pre-pass, folds `<tool_results>` into
  context); wired into the stream route + `applyAdvanceSideEffects`.
- Canvas: `McpNode`, "MCP Tool" picker option, node config editor
  (server/tool/request+response fields, conversational MCP-tools allow-list),
  save/load in both flow editors.

## Files created

- `packages/application/src/use-cases/session/{run-mcp-node.ts,run-mcp-node.test.ts}`
- `packages/adapters/src/mcp/{mcp-tool-prepass.ts,mcp-tool-prepass.test.ts}`
- `apps/web/src/components/canvas/mcp-node.tsx`
- `tests/e2e/phase-mcp-flow-consumption.spec.ts`
- `docs/development/implemented/alpha-2/v2.3.0/{phase-mcp-flow-consumption.phase.md,_implementation-summary.md}`

## Files modified

- application: `use-cases/mcp/mcp.ts` (+`ResolveStepTools`) + test,
  `use-cases/session/index.ts`
- adapters: `mcp/index.ts`
- web: chat `route.ts` + `turn-helpers.ts` (dispatch + pre-pass), `lib/container.ts`,
  canvas `node-styles.tsx` / `node-defaults.ts` / `node-type-picker-modal.tsx` /
  `node-config-modal.tsx`, both flow-editor `_content.tsx`, `server/routers/flow.ts`,
  `scheduled-node-config.test.ts` (fixture)

## Migrations

- None. The `mcp` node type (TS enum) and MCP tables landed in Phase 2a (0030).

## Tests

- Unit (green in this session): `RunMcpNode` (5), `ResolveStepTools` (3),
  `selectAllowedTools` (4), plus the existing MCP/skill/graph suites.
- e2e: `tests/e2e/phase-mcp-flow-consumption.spec.ts` — add MCP Tool step +
  conversational allow-list picker. Requires a running stack; not executed here.

## Known limitations / deferred

- The conversational tool-loop pre-pass is non-streaming; its live behaviour is a
  staging smoke test (only `selectAllowedTools` is unit-tested).
- `context`/`actions` server kinds, `businessSelectable`, and streamable-HTTP
  transport remain deferred to the Phase 3 flag-split.
- Full `./validate.sh` / e2e not runnable in the sandbox (no infra; unlinked pnpm
  bins). Web app typechecks clean apart from the pre-existing `.css` noise.
