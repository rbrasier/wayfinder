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

## Amendment 1 — progress while tools are consulted

Approved after review: a longer turn is fine as long as the person can see why. The pre-pass now runs inside the reply stream and reports what it is doing.

- `runMcpToolPrepass` takes `onActivity` and reports the servers' labels as the lookup starts and `null` when it ends.
- The stream route hands `executeTurn` a `prepareTurn` closure (tool lookup, then the system prompt from its results). `executeTurn` calls it after the user message is stored and the spend cap is checked, and writes each report as a `consulting-tools` annotation (new `TurnStreamAnnotation` variant). The step opener after an in-chat advance reports through the same annotation.
- An AI task, and a step opener an unattended run writes, have no stream: they publish a `step.activity` session event (new `SessionEvent`, ephemeral like `typing`) via `lib/automation/step-activity.ts`.
- The chat's typing row now carries a label (`components/chat/turn-activity.ts`): "Thinking…" by default and "Consulting ParlView…" (server labels, "A and B", "A, B and C") during a lookup. A streamed message that so far carries only annotations renders no empty bubble. When the next step's opener looks things up after a reply, the row appears under that reply. The page turns `step.activity` into the same row, and an AI task's pending line into "AI task running — consulting ParlView…".
- Tests: `turn-activity.test.ts` (new), `automation-step-state.test.ts`, `mcp-turn-helpers.test.ts`, `execute-turn.test.ts`, `turn-helpers.test.ts`, `ai-task-context.test.ts`, `session-event.test.ts`. E2E: `chat.spec.ts` gains "a turn says what it is doing while it waits" (e2e-test-policy group 2, streaming into the DOM), replaying a slow stream in the page.

## Amendment 2 — tool limits, stored MCP tokens, and waivers that expire

Approved after review (improvements 1 and 3 of three proposed; the per-step "look things up first" setting is deferred).

- **Partial results on timeout.** `McpToolPrepass` collects each finished round through `onStepFinish`. When the 15-second deadline aborts the loop, it returns the calls already made (and records their token usage) instead of failing with nothing. With no finished round it still fails as before.
- **Stored MCP tokens in the pre-pass (bug found in review).** The pre-pass built its MCP transport without the token saved in the admin UI (v0.28.42 moved tokens into the database), so such a server was called unauthenticated. `McpToolPrepass` now takes the credential store and passes the stored token, as `AiSdkMcpClient` does.
- **Tool count warning.** `InstructionToolBar` (shared by the conversational and AI task editors) shows a non-blocking note past `RECOMMENDED_MAX_STEP_TOOLS` (8): more tools make the step slower and likelier to pick the wrong one.
- **Waivers that expire.** CI's Trivy image gate began flagging zod 3.25.76 as CVE-2023-54404, the CVE alias of GHSA-mrhx-c7xc-m3w5 already waived for the lockfile gates. `.trivyignore` now waives it, and a new `scripts/waiver-check.mjs` (rules in `scripts/waiver-rules.mjs`, tested with `node --test`) re-checks every waiver against OSV and the lockfile. It fails when a fix lands within the major line already in use (naming the upgrade), or when nothing in the lockfile is vulnerable any more. It also fails when a `.trivyignore` entry waives anything the allowlist does not. It runs in `validate.sh` (section 11c, skipped offline), strictly in CI's security job, and weekly in `.github/workflows/waiver-review.yml` on `main` and the current release branch, which opens or refreshes an issue when a waiver needs action.

## Regression tests

- `stream/mcp-turn-helpers.test.ts` (new) — prompt carries brief, known context and the look-it-up instruction; results returned apart; audit only on `recordAudit`; no tools → nothing.
- `stream/execute-turn.test.ts` — tool note recorded after the user message.
- `stream/turn-helpers.test.ts` — the opener runs the pre-pass, its prompt carries the results, the note precedes the opener.
- `adapters/agents/flow-session-graph.test.ts` — `<tool_results>` block with its instruction, outside `<gathered_context>`.
- `lib/automation/ai-task-context.test.ts` — the pre-pass sees the run's inputs; results framed; audit recorded.
- `components/sidebar-model.test.ts` — group open state follows Event Watch attention.

## E2E

Tool calling itself needs a live MCP server and model, so the fixes are guarded by unit tests. The progress label (Amendment 1) is streamed into the DOM and has an e2e test in `chat.spec.ts`.
