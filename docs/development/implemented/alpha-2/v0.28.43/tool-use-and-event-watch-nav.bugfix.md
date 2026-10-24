# Bug fix — MCP tool use in chat and AI task steps; Event Watch in Advanced Flow Settings

**Version:** 0.28.43 (PATCH) · **Base:** `release/alpha-2` · **Branch:** `bugfix/tool-use-and-email-card/claude-rbrasier` · **Issue:** none

## Reported symptoms

1. A step with MCP tools rarely uses them unprompted; the operator has to tell it to ("Look for a transcript - use tools").
2. "Consulted 4 tool calls (…)" shows *above* the message that caused the lookup.
3. Once tools have run, the reply still says "Let me look that up for you now!" — the results only surface a turn or two later, when the operator asks what the tools returned.
4. The Email step's message shows as a chat reply instead of the Email card.
5. (Request) Event Watch belongs under the admin sidebar's Advanced Flow Settings group.

## Reproduction

A flow started by an Event Watch (inputs carry `parlViewId`), whose conversational step allows the ParlView MCP tools (`search_broadcasts`, `list_live_broadcasts`, `get_transcript`), followed by an AI task and an Email step. Ask "What did the hearing cover?", then "Look for a transcript - use tools", then "what was the tool results?".

## Root cause (verified in code)

The conversational tool loop (ADR-032) is a non-streaming pre-pass, `runMcpToolPrepass` in `apps/web/src/app/api/chat/[sessionId]/stream/mcp-turn-helpers.ts`, run by the stream route before the turn.

1. **The pre-pass is blind to the step.** Its system prompt was one generic sentence ("You may call the available tools…") and its messages were the chat lines only. It never saw the step's instruction, what the step must achieve, or the context already gathered — so it had no `parlViewId` to look up and no reason to look anything up until the operator named the tools. The step's opening message (`generateInitialMessage`) ran no pre-pass at all, so the first message asked the operator for what a tool could have fetched. An AI task's pre-pass (`lib/automation/ai-task-context.ts`) passed its instruction but `gatheredContext: ""`, so it too never saw the run's inputs.
2. **The audit note is written before the user message.** The route runs the pre-pass (which persists the "Consulted …" system message) before `createDataStreamResponse`, while the user's message is persisted later inside `executeTurn`. The note gets the earlier sequence number, so it renders above the message that triggered it.
3. **Tool results were framed as gathered context.** The results were appended to the gathered-context string and rendered inside `<gathered_context>`, whose wording invites follow-up questions about it. Nothing told the model the lookup had already happened for this turn, so having been asked to "use tools" it answered as if it still had to.
4. **Email card — not reproduced.** On `release/alpha-2` the card renders for an Email step mid-run and as the last step after a chat turn, both live and after a reload (`automationResultView` returns `card` for an assistant message on an `email` node). The report matches the stale dev build seen with the `flowStepKeys` error; no code change.

## Fix plan

- `runMcpToolPrepass` takes the step's brief (`stepBrief`) and what is already known (`gatheredContext`), builds a system prompt that tells the model to look up whatever the tools can supply that the step still needs — using identifiers from the known context — rather than ask the operator, and returns `{ toolResults, recordAudit }` instead of a merged context string.
- The stream route passes `toolResults` to `buildSystemPrompt` and hands `recordAudit` to `executeTurn`, which calls it right after persisting the user message.
- `BuildSystemPromptInput.toolResults` renders as its own `<tool_results>` block telling the model the lookups were made for this turn and to answer from them — never claim no access, never say it is about to look something up.
- `generateInitialMessage` runs the pre-pass (with "Please begin." as the message) before the opener when the step allows tools.
- The AI task pre-pass gets the instruction as its brief and the run's gathered context and trigger inputs as known context; its results are wrapped in the same framed block.
- Sidebar: Event Watch moves into Advanced Flow Settings; the group starts open while a watch needs attention, so the badge is never hidden.

## Tests (written first)

- `mcp-turn-helpers.test.ts` — the pre-pass prompt carries the brief, the known context and the proactive instruction; tool results come back separately; the audit note is written only when `recordAudit` runs.
- `execute-turn.test.ts` — the audit note is recorded after the user message.
- `flow-session-graph.test.ts` — `toolResults` renders as a `<tool_results>` block with its instruction, outside `<gathered_context>`.
- `turn-helpers.test.ts` — the opener runs the pre-pass and its prompt carries the results.
- `ai-task-context.test.ts` — the AI task pre-pass sees the run inputs.
- `sidebar-model.test.ts` — Event Watch sits in Advanced Flow Settings, which starts open when a watch needs attention.

No e2e: tool calling needs a live MCP server and model; the unit tests are the guard.
