# Implementation Summary — AI usage recorded against the wrong model, and document generation never budgeted

- **Version**: 0.28.11 (bump: **PATCH** — recording correctness and call
  attribution; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`
- **Bug-fix doc**: [`usage-recording-resolved-model.bugfix.md`](./usage-recording-resolved-model.bugfix.md)

## Root cause

Two defects on the same path.

**1. The recorded model was the provider default.** Model resolution happens
inside `LanguageModelAdapter`, which reads `config.models[purpose]` from the
runtime config. Usage recording happens in `UsageTrackingAdapter`, wrapped
*around* it, which had only the caller's input and fell back to
`defaultModelFor(provider)`. Callers that pass a model explicitly (the chat
stream route, the branching calls) were recorded correctly; every caller that
routes by purpose — all of document generation, grading, the readiness gate,
extraction, auto and MCP nodes — was recorded as `claude-sonnet-5` whatever it
actually ran on. `estimateCost` prices from the recorded name, so opus output
tokens were billed at roughly a fifth of the true rate. The same split affected
the provider: `resolveForCall` reads the runtime provider, the decorator recorded
the boot-time one, so a runtime provider switch was recorded and priced against
the old provider.

**2. The document-generation chain passed no user.** `QuotaEnforcer.check`
returns early on a missing `userId`, and neither `GenerateDocumentInput` nor
`EvaluateStepReadinessInput` carried one — so field extraction, grading, the
readiness gate and the document summary all wrote `user_id = NULL` rows that no
budget ever saw. `extractStructuredFields` and `gradeDocumentFields` already
accepted the attribution fields; their callers simply never passed any. Two
approvals-branching calls had the same gap.

## Fix applied

- **`packages/domain/src/ports/language-model.ts`** — new `CalledModel`
  (`provider` + `model`), intersected into all four `ILanguageModel` result
  payloads. The component that resolves the model is now the one that reports it.
- **`packages/adapters/src/ai/language-model-adapter.ts`** — every result carries
  the resolved provider and model.
- **`packages/adapters/src/observability/usage-tracking-adapter.ts`** — records
  what the inner call reported instead of the caller's input and the boot-time
  provider. The `input.model ?? defaultModelFor(...)` fallback stays inside
  `recordTokenUsage` for the two direct-SDK callers that record by hand (the MCP
  tool pre-pass and the scheduled-fire branch choice), both of which pass a real
  model name.
- **`quota-enforcing-adapter.ts`, `langfuse-tracing-adapter.ts`,
  `scripted-language-model.ts`** — signatures widened; the scripted E2E
  stand-in reports the caller's override or `scripted-model`, so E2E rows stay
  distinguishable from billed traffic.
- **`generate-document.ts`** — `userId` added to the input and threaded to field
  extraction, the summary call and grading, each with `flowId` and `sessionId`.
- **`evaluate-step-readiness.ts`** — `userId` and `sessionId` added to the input
  and threaded to extraction and grading.
- **`resolve-approval-subject.ts`** — bills `approval.requestedByUserId`.
- **`suggest-approver.ts`** — bills `input.requestedByUserId` with flow and
  session.
- **`turn-helpers.ts`, `api/documents/[documentId]/route.ts`,
  `execute-turn.ts`** — supply the authenticated user at the edge.

## Regression tests added

- `usage-tracking-adapter.test.ts` — five cases covering all four call shapes:
  the resolved model is recorded rather than the provider default, opus is priced
  above sonnet, and a runtime provider switch is recorded as the provider that
  ran. **Failed before the fix**, recording `claude-sonnet-5` for an opus call.
- `language-model-adapter.test.ts` — six cases: the resolved model and provider
  are surfaced on `generateObject`, `generateText`, `streamText` and
  `streamObject`; an explicit override is reported as given; and the runtime
  provider wins over the constructor's.
- `generate-document.test.ts` / `evaluate-step-readiness.test.ts` — every model
  call made during generation and the readiness gate carries the caller's
  `userId`, `flowId` and `sessionId`. **Failed before the fix**, all three
  `undefined`.
- `resolve-approval-subject.test.ts` — the custom-subject summary is billed to
  the user who requested the approval.

Full suite green: `./validate.sh` — 24 passed, 0 failed.

## E2E decision

**No Playwright spec added.** The fixed behaviour is server-side usage recording
with no DOM surface of its own, and falls into none of the six groups in
`docs/guides/e2e-test-policy.md`. The regression tests above are the guard and
run on every `./validate.sh`.

## Deviations from the approved summary

- The approved summary listed a `quota-enforcing-adapter.test.ts` case asserting
  that a doc-gen call for an over-cap user is blocked. It was dropped: that
  adapter already blocks any call carrying a `userId`, so the test would have
  passed before the fix and guarded nothing. The defect was that no `userId`
  reached it, which the `generate-document.test.ts` and
  `evaluate-step-readiness.test.ts` attribution tests cover directly.
- Two typed test doubles (`FakeLanguageModel` in `batch-engine.test.ts`,
  `StubLanguageModel` in `approval-doubles.ts`) were updated to satisfy the
  widened port. Not listed in the summary's file list.

## Known limitations

- Existing `ai_usage_events` rows are not backfilled. The correction applies from
  deploy forward, so the Usage page mixes corrected and mislabelled history until
  the reporting window rolls past the deploy.
- `apps/api` (the extraction worker) wires `withUsageTracking` but no
  `withQuotaEnforcement`, so its calls are recorded but never capped. It runs
  extraction only, which has its own per-run cost ceiling (ADR-033 §9).
- Template summarisation, AI column mapping, extraction file grouping, scheduled
  node specs and the LangGraph agent runner still make unattributed calls.
- Langfuse traces still log the caller-supplied model and the boot-time provider.
