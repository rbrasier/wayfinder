# Bug Fix: Model Name Not Saved to Usage Events

**Date:** 2026-05-10
**Version bump:** PATCH → 0.4.1
**Severity:** Minor

## Symptom

On `/admin/usage`, the "Model" column is blank for all usage rows. The "Usage by model" table groups by provider + model, but model is an empty string so aggregation is meaningless.

## Root Cause

In `packages/adapters/src/observability/usage-tracking-adapter.ts`, the `record()` function falls back to an empty string when `input.model` is undefined:

```typescript
const model = input.model ?? "";
```

Call sites (`SendMessage`, `LangGraphAgentRunner`) do not pass a `model` value, so it is always `undefined`. The provider default is never applied, and an empty string is stored in `ai_usage_events.model`.

`providers.ts` already exports `defaultModelFor(provider)` which returns the correct default model string — it just wasn't being used here.

## Fix

Replace the empty-string fallback with `defaultModelFor(input.provider)`:

```typescript
// before
const model = input.model ?? "";

// after
const model = input.model ?? defaultModelFor(input.provider);
```

Import `defaultModelFor` from `../ai/providers`.

## Files Changed

- `packages/adapters/src/observability/usage-tracking-adapter.ts` — use default model name instead of empty string
