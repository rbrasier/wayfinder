# Bug Fix — AI usage recorded against the wrong model, and document generation never budgeted

- **Status**: Implemented in 0.28.11
- **Target version**: **PATCH** — 0.28.10 → 0.28.11 (recording correctness and
  call attribution; no schema change)
- **Base branch**: `release/alpha-2`
- **Type**: `/bugfix`
- **PRD / ADR**: ADR-026 (usage limits and enforcement), ADR-031 (master switch)

## 1. Symptom

The admin **Usage** page shows two model rows for an install whose AI Provider
card configures three distinct models:

| Provider | Model | Calls |
|---|---|---|
| anthropic | `claude-sonnet-4-6` | 88 |
| anthropic | `claude-sonnet-5` | 81 |

The configured document-generation model — `claude-opus-5` — never appears, even
though document generation demonstrably ran. Estimated cost is correspondingly
low, and document-generation spend does not move a user's usage meter.

## 2. Reproduction

1. Admin → Settings → AI Provider: set **Chat model** and **Branching model** to
   `claude-sonnet-4-6`, and **Document generation model** to `claude-opus-5`.
2. Run a session through a `generate_document` step so the pre-generation gate
   and the document generation itself both fire.
3. Admin → Usage. No `claude-opus-5` row exists; the `claude-sonnet-5` row's call
   count has grown instead.
4. Set a daily budget for that user well below the run's real cost and repeat.
   The run is not blocked and the user's meter does not reflect it.

## 3. Root cause — two defects on the same path

### 3.1 The recorded model is the provider default, not the model called

Model resolution happens *inside* the adapter. `LanguageModelAdapter` resolves
each call's model from the runtime config by purpose
(`packages/adapters/src/ai/language-model-adapter.ts`):

```ts
const model = inputModel ?? config.models[purpose];
```

Usage recording happens *outside* it, in the decorator, which has only the
caller's input to go on
(`packages/adapters/src/observability/usage-tracking-adapter.ts`):

```ts
const model = input.model ?? defaultModelFor(input.provider);
```

The two never meet. Callers that pass `model` explicitly — the chat stream route
and the branching calls, which read `aiConfig.models.chat` / `.branching`
themselves — are recorded correctly. Every caller that relies on purpose routing
instead (all of document generation, grading, the readiness gate, extraction,
auto/MCP nodes) is recorded as `defaultModelFor("anthropic")`, i.e.
`claude-sonnet-5`, whatever it actually ran on.

That is exactly the two-row table above: `claude-sonnet-4-6` is the explicitly
passed chat/branching traffic; `claude-sonnet-5` is a bucket holding everything
else, including the opus document-generation calls.

The cost estimate inherits the error. `estimateCost` prices from the recorded
model name, so opus output tokens are billed at the sonnet rate — roughly a fifth
of the true figure.

The same split affects the provider. `resolveForCall` uses `config.provider` from
the runtime config store, which an admin can change without a redeploy, while the
decorator records `this.inner.provider`, fixed at construction. After a runtime
provider switch, rows name the old provider and are priced from its table.

### 3.2 The document-generation chain passes no user

`QuotaEnforcer.check` returns early when there is no user:

```ts
async check(userId?: string | null): Promise<Result<true>> {
  if (!userId) return ok(true as const);
```

`GenerateDocumentInput` and `EvaluateStepReadinessInput` carry no `userId` field
at all, so nothing downstream can supply one:

- `GenerateDocument.resolveFieldValues` → `extractStructuredFields` — the field
  extraction batches, the most expensive calls in the product
- `GenerateDocument` → the document-summary `generateObject` call
- `GenerateDocument.persistDocumentGrading` → `gradeDocumentFields`
- `EvaluateStepReadiness.execute` → `extractStructuredFields` and
  `gradeDocumentFields`

`extractStructuredFields` and `gradeDocumentFields` both already accept
`userId` / `flowId` / `sessionId` and forward them to the port. Their doc-gen
callers simply never pass any. Both callers have the values to hand:
`turn-helpers.ts` and `api/documents/[documentId]/route.ts` both hold the session
and the authenticated user.

Two approvals-branching calls have the same gap:
`ResolveApprovalSubject.resolveCustom` passes `sessionId` and `flowId` but not
`userId` (available as `approval.requestedByUserId`), and
`SuggestApprover.extractPosition` passes none of the three (available on
`SuggestApproverInput` as `requestedByUserId`).

Consequence: those rows land with `user_id = NULL`. They are invisible to the
per-user meter and to `summarizeBy("user")`, and — because the enforcer
short-circuits — they are never checked against a cap and never contribute to
one.

## 4. Fix plan

**Surface what the call actually used.** Add `model: string` and
`provider: ProviderName` to all four `ILanguageModel` result payloads. The
adapter that performs the resolution is the only component that knows the answer,
so it becomes the one that reports it; `UsageTrackingAdapter` records those
values instead of guessing. The existing `input.model ?? defaultModelFor(...)`
fallback stays inside `recordTokenUsage` for the two direct-SDK callers that call
it by hand (the MCP tool pre-pass and the scheduled-fire branch choice), both of
which already pass a real model name.

**Thread attribution through the document-generation chain.** Add
`userId` to `GenerateDocumentInput`, and `userId` + `sessionId` to
`EvaluateStepReadinessInput`; pass them to every model call those use cases make.
Supply them at both call sites in `apps/web`. Do the same for the two
approvals-branching calls from values already on the entity and the input.

**No schema change.** `ai_usage_events` already stores `model`, `provider` and
`user_id`. The defect is what gets written into them, so no migration is
required and no `-- data-impact:` line applies.

## 5. Regression tests

1. `usage-tracking-adapter.test.ts` — a purpose-routed call whose inner model
   reports `claude-opus-5` records `claude-opus-5` at the opus rate, not the
   provider default. Fails today.
2. `language-model-adapter.test.ts` — the resolved model and provider are
   surfaced on all four result shapes, including a runtime provider that differs
   from the one the adapter was constructed with.
3. `generate-document.test.ts` / `evaluate-step-readiness.test.ts` — every model
   call made during generation and during the readiness gate carries the caller's
   `userId`. Fails today.
4. `quota-enforcing-adapter.test.ts` — a document-generation call for a user over
   their cap is blocked. Fails today (it is allowed through, unattributed).

**No Playwright e2e.** The fixed behaviour is server-side recording with no DOM
surface of its own and falls into none of the six groups in
`docs/guides/e2e-test-policy.md`. The regression tests above are the guard and
run on every `./validate.sh`.

## 6. Out of scope

- Backfilling or correcting existing `ai_usage_events` rows. The correction
  applies from deploy forward.
- `apps/api` (the extraction worker) wires `withUsageTracking` but no
  `withQuotaEnforcement`, so its calls are recorded but never capped. It runs
  extraction only — not document generation — and extraction has its own per-run
  cost ceiling (ADR-033 §9). Flagged, not fixed here.
- Attribution for template summarisation, AI column mapping, extraction file
  grouping, scheduled node specs and the LangGraph agent runner, which have the
  same missing-`userId` gap on paths unrelated to this report.
- Langfuse traces still log the caller-supplied model and the boot-time provider.
