# Implementation Summary — Code Quality: Hot Paths, Group B (slice 1) (v2.2.1)

- **Version**: 2.2.1 (**PATCH** — behaviour-preserving internal refactor of one
  call site; no schema change, no API/UI change).
- **Date**: 2026-07-05
- **Phase**: "Code Quality: Hot Paths, Boundaries, and Decomposition", **Group B
  — Streaming inside the `ILanguageModel` port** (phase doc under
  `to-be-implemented/`). This is the phase's explicitly riskiest group; it is
  being landed in small, individually-verifiable slices.
- **Scope built**: the **branch-choice** `generateObject` call in the chat stream
  route now goes through the `ILanguageModel` port instead of calling the AI SDK
  directly with hand-rolled governor + usage plumbing (part of item 5).

## Context — what was already in place

The `ILanguageModel` port already declares `streamObject`/`streamText`,
`LanguageModelAdapter` implements them, and all three decorators
(`withUsageTracking`, `withQuotaEnforcement`, `withOptionalLangfuse`) cover them.
Crucially, the shared `LlmCallGovernor` is passed **into** `LanguageModelAdapter`
(container), so routing a call through `container.services.llm` applies the
governor, usage recording, and quota enforcement automatically — the exact
decorators the route was re-plumbing by hand (ADR-026).

## What was built

`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`: the lazy
`computeBranchChoice` path previously called the AI SDK's `generateObject`
wrapped in `container.services.llmGovernor.run(...)` and then recorded usage with
a manual `recordTokenUsage(...)`. It now calls
`container.services.llm.generateObject<BranchChoice>({ purpose:
"chat-branch-choice", userId, flowId, sessionId, model: branchingModelName,
schema, system, messages })`. The governor, usage recording, and quota
enforcement come from the decorator chain; the hand-rolled governor run,
`recordTokenUsage`, and the SDK `generateObject` import are gone from that path.

Behaviour is preserved: same governor instance, same model
(`branchingModelName`), same schema, same "return null on any failure"
semantics, and the same usage row (user/flow/session/model/tokens). The only
difference is the vestigial `conversation_id` on that one usage row, previously
set redundantly to the session id and not read by any spend-cap or dashboard
query (those key on `session_id`/`flow_id`; `conversation_id` belongs to the
separate ad-hoc `ai_conversations` feature).

## Files changed

- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — branch-choice call
  routed through the port; `generateObject` SDK import removed.
- `VERSION`, `package.json` — 2.2.0 → 2.2.1.

## Migrations run

None.

## Tests

Covered by `pnpm typecheck` + the full unit suite + the existing chat e2e
(`tests/e2e/chat.spec.ts`) which drives a real turn through the route in CI. No
new unit test: this is a call-site swap onto already-tested port/decorator
machinery (the adapter and decorators have their own streaming tests).

## Known limitations / remaining Group B work

The bulk of Group B is deliberately **not** in this slice, because its risk
mitigation — the e2e chat suite — cannot run in this sandbox (no Postgres /
browser), and two conversions need real end-to-end validation:

- **The streaming turn (`stream-turn.ts`) is not yet ported.** It uses Anthropic
  `cache_control` prompt caching (system-as-cached-message `providerOptions`), an
  `onError` callback, and `providerMetadata` for cache-usage accounting — none of
  which the port's `streamObject` input currently exposes. Porting it naively
  would **regress prompt caching** (a real cost regression). This needs the port
  extended to carry a cached-prefix/provider-options + error + provider-metadata
  surface, then validated behind the chat e2e.
- **`turn-helpers.ts`** still calls the SDK directly for title generation, the
  gap follow-up, and the advance-time branch/doc-gen path; these convert the same
  way once the streaming surface above lands.
- **Item 6** (extract turn orchestration into an application-layer `ExecuteTurn`
  use case + stream-writer abstraction, shrinking the route to auth + lease +
  HTTP translation, moving the pure gate modules) is a large structural change
  best done after the streaming port surface exists and behind the chat e2e.

Recommendation: land the remaining Group B conversions in an environment where
`tests/e2e/chat.spec.ts` runs, since it is the phase's stated mitigation for this
group.
