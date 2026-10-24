# Summary — MCP tool use in chat and AI task steps; Event Watch in Advanced Flow Settings (v0.28.43)

## Root cause

The MCP tool pre-pass (`runMcpToolPrepass`) was told only that it "may" call tools and saw nothing but the chat lines — not the step's instruction, not what it must achieve, not the run's inputs. It looked things up only when the operator named the tools, and had no identifier (`parlViewId`) to look them up with. Its audit note was persisted before the turn's user message, so it rendered above the message that prompted it. Its results were folded into `<gathered_context>`, framed as captured facts open to follow-up — so a model asked to "use tools" replied that it would look it up, though the lookup had already run. The step opener ran no pre-pass, and the AI task pre-pass got no run inputs.

## Fix applied

- `runMcpToolPrepass` takes a `stepBrief` and the known context, prompts the loop (`buildToolPrepassSystemPrompt`) to look up what the step needs rather than ask the user, and returns `{ toolResults, recordAudit }`.
- `executeTurn` calls `recordToolAudit` straight after persisting the user message.
- `BuildSystemPromptInput.toolResults` (domain port) renders as its own `<tool_results>` block telling the model the lookups were made for this turn and to answer from them.
- `generateInitialMessage` (now taking `isAdmin`) runs the pre-pass before the opener; all three callers pass it.
- `buildAiTaskContext` gives the pre-pass the instruction as its brief and the trigger inputs (item capped at 4,000 characters) plus gathered context as known context, and records the audit note.
- Sidebar: Event Watch moved into Advanced Flow Settings; `advancedFlowSettingsStartsCollapsed` opens the group while a watch needs attention.
- Email card (reported symptom 4): not reproduced on `release/alpha-2` — verified in a browser for an Email step mid-run and as the last step after a chat turn, live and after reload. No change.

## Regression tests

- `stream/mcp-turn-helpers.test.ts` (new) — prompt carries brief, known context and the look-it-up instruction; results returned apart; audit only on `recordAudit`; no tools → nothing.
- `stream/execute-turn.test.ts` — tool note recorded after the user message.
- `stream/turn-helpers.test.ts` — the opener runs the pre-pass, its prompt carries the results, the note precedes the opener.
- `adapters/agents/flow-session-graph.test.ts` — `<tool_results>` block with its instruction, outside `<gathered_context>`.
- `lib/automation/ai-task-context.test.ts` — the pre-pass sees the run's inputs; results framed; audit recorded.
- `components/sidebar-model.test.ts` — group open state follows Event Watch attention.

## E2E

None: tool calling needs a live MCP server and model, outside the e2e policy's groups; the unit tests are the guard.
