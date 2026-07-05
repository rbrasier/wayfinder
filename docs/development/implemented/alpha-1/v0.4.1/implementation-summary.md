# Implementation Summary — v0.4.1

**Date:** 2026-05-10
**Version bump:** PATCH (0.4.0 → 0.4.1)

## What Was Built

Fixed a bug where the model name was stored as an empty string in `ai_usage_events`, causing the `/admin/usage` page to show blank model values.

## Root Cause

`usage-tracking-adapter.ts` fell back to `""` when `input.model` was undefined. Call sites never pass an explicit model, so every usage event was recorded with an empty model string.

## Fix

Replaced the empty-string fallback with `defaultModelFor(input.provider)`, which returns the provider's configured default model name (e.g. `claude-haiku-4-5-20251001`). The helper already existed in `providers.ts` — it just wasn't used here.

## Files Modified

- `packages/adapters/src/observability/usage-tracking-adapter.ts`
  - Added import: `defaultModelFor` from `../ai/providers`
  - Changed: `input.model ?? ""` → `input.model ?? defaultModelFor(input.provider)`

## Known Limitations

- Historical usage events already in the database will still have an empty model string. A one-off migration would be needed to backfill them if required.
