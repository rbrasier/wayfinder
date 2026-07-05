# Bug Fix: Invalid Anthropic Sonnet model ID breaks document generation

## Symptom

Generating or re-generating a document fails with a 500 from
`POST /api/documents/[id]`. Server logs show:

```
AI_APICallError: model: claude-sonnet-4-5-20251001
  ...
  at LanguageModelAdapter.generateObject (packages/adapters/src/ai/language-model-adapter.ts)
  at UsageTrackingAdapter.generateObject (packages/adapters/src/observability/usage-tracking-adapter.ts)
  at GenerateDocument.execute (packages/application/src/use-cases/document/generate-document.ts)
```

Chat and branching are unaffected.

## Reproduction

1. Configure the app with the direct **anthropic** provider (default).
2. Trigger a document generation/re-generation.
3. The Anthropic API rejects the request because the requested model does not exist.

## Root Cause (verified)

`packages/adapters/src/config/runtime-config-store.ts` line 18 defines the
direct-Anthropic default model for `documentGeneration` as:

```
documentGeneration: "claude-sonnet-4-5-20251001"
```

That snapshot ID does not exist. The real Claude Sonnet 4.5 snapshot is
`claude-sonnet-4-5-20250929` — already used correctly by the Bedrock entry
(`anthropic.claude-sonnet-4-5-20250929-v1:0`, line 33). The `-20251001`
suffix is the valid snapshot for **Haiku 4.5** (used on lines 17/19), and was
mistakenly carried over to the Sonnet entry.

Because chat and branching default to Haiku (`-20251001`, valid) they work,
while document generation defaults to the bogus Sonnet ID and fails at the
Anthropic API boundary.

## Fix Plan

- Change line 18 to `claude-sonnet-4-5-20250929`.
- Add a regression test asserting the anthropic `documentGeneration` default
  resolves to the valid Sonnet 4.5 snapshot.
- Run `./validate.sh`.
- PATCH version bump.

## Implementation Summary

- **Root cause:** `runtime-config-store.ts` set the direct-Anthropic
  `documentGeneration` default to the non-existent snapshot
  `claude-sonnet-4-5-20251001` (the `-20251001` suffix belongs to Haiku 4.5).
  The Anthropic API rejected every document-generation request, surfacing as
  `AI_APICallError` and a 500 from `POST /api/documents/[id]`.
- **Fix applied:** changed the value to the valid snapshot
  `claude-sonnet-4-5-20250929` (matching the Bedrock entry).
- **Regression test:** added
  `RuntimeConfigStore — anthropic defaults > uses a valid Claude Sonnet 4.5
  snapshot for document generation` in `runtime-config-store.test.ts`, which
  asserts the anthropic `documentGeneration` default resolves to
  `claude-sonnet-4-5-20250929`. Verified failing before the fix, passing after.
- **Version:** PATCH bump `1.15.1` → `1.15.2`.
