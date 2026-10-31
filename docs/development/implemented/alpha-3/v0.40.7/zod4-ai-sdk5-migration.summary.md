# Summary — zod 4, AI SDK 5 and LangChain 1.x on main (v0.40.7)

Port of alpha-2's v0.28.49 (`3e79e6d1`, PR #372) onto `main`. The release line's
phase doc and summary (`implemented/alpha-2/v0.28.49/zod4-ai-sdk5-migration.*`)
are the spec and reach `main` with the next forward-merge; this file records what
differed here. Version: 0.40.6 → 0.40.7 (PATCH, no schema change). No issue.

## What changed

No package in the lockfile resolves zod below 4.6.6. The GHSA-mrhx-c7xc-m3w5
waiver is gone from `scripts/audit-allowlist.sh` and `.trivyignore`
(CVE-2023-54404), and `main`'s zod 3 stack — `ai@4`, `@ai-sdk/*` 1.x,
`@langchain/core@0.3`, `@langchain/langgraph@0.2` — moves to `ai@5`,
`@ai-sdk/*` 2.x (bedrock 3.x), `@ai-sdk/react` 2.x and LangChain 1.x, which
also removes better-auth 1.7's unmet `zod >=4.6.6` peer warning. Behaviour is
unchanged: validation outcomes, token limits, usage figures and chat badges.

## Where `main` differed from alpha-2

- **MCP client.** `main` replaced the AI SDK MCP client with its own SDK client
  (ADR-062), so alpha-2's `@ai-sdk/mcp` dependency and `ai-sdk-mcp-client.ts`
  edits are not carried. The pre-pass (`mcp-tool-prepass.ts`) takes the v5 changes
  by hand: `stopWhen: stepCountIs`, `inputSchema`, `LanguageModel`, step usage as
  `inputTokens`/`outputTokens`, and `totalUsage` so a multi-step tool loop is not
  billed as one call (regression test added).
- **Embeddings.** `main`'s dispatching adapter builds per-provider models. The
  OpenAI `dimensions` and Bedrock Titan `dimensions` settings, which `@ai-sdk/*`
  2.x/3.x drop from model creation, now ride on each `embed()` call as
  `providerOptions`, so vectors stay `EMBEDDINGS_DIMENSION` wide (ADR-017).
- **Procedure guards.** `main`'s routers keep their own guards
  (`adminProcedure`, `authenticatedProcedure`); only the zod 4 syntax moved
  (`.uuid()` → `.guid()`, two-argument `z.record`). Router code that only exists
  on `main` (`flow-test`, `lookup-source`, `flow-memory`, `user`, `approval`,
  `extraction-size-limits`) got the same treatment.
- **Package scope.** Alpha-2's `@rbrasier/*` imports became `@wayfinder/*`.
- **Request-body caps (v0.40.6)** are unaffected: they sit in front of validation.

## Verification

Unit tests pass in every package (web 1475, application 1561, domain 1371,
adapters, api, mocks, shared) and `tsc --noEmit` is clean. E2E: the chat specs
and `chat-mock.ts` take alpha-2's v5 SSE framing (policy group "streaming into
the DOM"); CI runs the suite.

## Known limitations

None known. Chat streaming is the highest-risk path; the e2e chat specs are its
check.
