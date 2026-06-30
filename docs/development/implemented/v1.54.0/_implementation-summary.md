# Implementation Summary — MCP Flow Consumption, Phase 2b (v1.54.0)

Completes Phase 2 of the Flow Skills & MCP PRD: MCP servers registered in Phase 2a
can now be *used inside flows*, two ways (ADR-032).

- **Version bump**: MINOR — `1.53.0` → `1.54.0` (new feature; no new tables —
  reuses `flow_nodes.config` and the existing step-output path).
- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/032-mcp-integration-and-tool-calling.adr.md`
  (testing strategy + decisions sections updated this phase).
- **Phase doc**: `phase-mcp-integration.phase.md` (this directory).

## What was built

### 1. Deterministic `mcp` node
- **Application** — `RunMcpNode` mirrors `RunAutoNode`: resolves request fields via
  the shared `resolveFieldValues` service, records a pending execution, calls the
  tool through `IMcpClient`, and returns a synchronous completion. The result is
  applied through the existing `ApplyAutoNodeResult` path (persist + advance), so
  the tool output lands in `session_step_outputs` exactly like an auto-node result
  (ADR-020). The tool result is exposed under the `output` key.
- **Runtime** — `dispatchMcpNode` in the chat turn pipeline runs the node when the
  session advances onto an `mcp` step.
- **Canvas** — new `mcp` node type end-to-end: node-type picker entry ("MCP Tool"),
  `McpNode` react-flow component, node styles/defaults, and a config section in the
  step modal (server + tool selectors from the live directory, instruction, and
  request/response field editors). Wired through `buildConfig`/`initialValues`/
  `toRfNode`/`NODE_TYPES` in both the admin and user flow editors.

### 2. Conversational tool-loop
- **Application** — `ResolveStepTools` resolves a step's `allowedMcpToolRefs` to the
  tools that may be offered, dropping any whose server is missing/disabled
  (deny-by-default).
- **Adapter** — `McpToolPrepass` runs a non-streaming `generateText` tool-loop over
  the allowed tools (assembled via `experimental_createMCPClient().tools()` and
  filtered by `selectAllowedTools`), returning gathered text. The structured
  streaming turn is left untouched; the pre-pass output is folded into the step's
  `gatheredContext` as a `<tool_results>` block (ADR-032).
- **Runtime** — `runMcpToolPrepass` runs before prompt-building on a conversational
  turn when the step allows tools; guarded so any failure leaves the turn unchanged.
- **Canvas** — an "MCP tools" picker in the conversational step editor toggles
  `allowedMcpToolRefs` (the enforcement boundary; pre-fillable from a skill's
  `allowedTools`).

## Files

**Created**
- `packages/application/src/use-cases/session/run-mcp-node.ts` (+ `.test.ts`)
- `packages/adapters/src/mcp/mcp-tool-prepass.ts` (+ `.test.ts`)
- `apps/web/src/components/canvas/mcp-node.tsx`
- `apps/web/e2e/phase-mcp-flow-consumption.spec.ts`

**Modified**
- `packages/application/src/use-cases/mcp/mcp.ts` (`ResolveStepTools`) + test
- `packages/application/src/use-cases/session/index.ts`
- `packages/adapters/src/mcp/index.ts`
- `apps/web/src/lib/container.ts` (runMcpNode, resolveStepTools, mcpToolPrepass)
- `apps/web/src/app/api/chat/[sessionId]/stream/turn-helpers.ts` (dispatchMcpNode,
  runMcpToolPrepass, mcp routing) and `route.ts` (pre-pass call)
- `apps/web/src/components/canvas/node-config-modal.tsx` (mcp config + allowed-tools
  picker + value fields), `node-defaults.ts`, `node-styles.tsx`,
  `node-type-picker-modal.tsx`, `scheduled-node-config.test.ts` (fixture)
- both flow editor `_content.tsx` files (NODE_TYPES, toRfNode, buildConfig,
  initialValues for `mcp` + conversational `skillRefs`/`allowedMcpToolRefs`)
- `apps/web/src/server/routers/flow.ts` (node `type` enum gains `mcp`)
- `VERSION`, `package.json`

## Tests

- Unit (vitest, run + passing): `RunMcpNode` (5 — happy path, no-config, missing
  server, disabled server, tool failure); `ResolveStepTools` (3 — empty, dedupe,
  deny-by-default); `selectAllowedTools` (4 — deny-by-default tool assembly).
- E2E: `phase-mcp-flow-consumption.spec.ts` — adding an MCP Tool step and the
  conversational allowed-tools picker. Driven by `/e2e` against a running stack;
  not executed here.

## Known limitations (per ADR-032)

- **Live LLM-over-MCP end-to-end is a staging smoke test**, not verified in the
  build sandbox (no provider keys / live server). The deterministic node, tool
  resolution, and deny-by-default selection *are* unit-tested with fakes.
- SSE transport only; Streamable HTTP needs a custom transport.
- The tool-loop is a pre-pass (gather-then-answer), not interleaved with the
  streaming structured turn — a deliberate ADR-032 decision to avoid
  stream-with-tools complexity.
- `mcp` request fields are author-defined (the tool's input schema is not
  auto-derived); the tool result is captured via a response field keyed `output`.
- `validate.sh` DB-dependent checks (drizzle) skip without `DATABASE_URL`.
