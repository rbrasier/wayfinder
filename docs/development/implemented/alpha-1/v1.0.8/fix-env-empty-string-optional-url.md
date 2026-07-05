# Bug Fix: API Crashes on Empty Optional URL Env Vars / OTel Warning in Web

## Root Cause A — API ZodError on OTEL_EXPORTER_OTLP_ENDPOINT

`apps/api/src/env.ts` passes `process.env` directly to `envSchema.parse()`.
When an optional field such as `OTEL_EXPORTER_OTLP_ENDPOINT` is present in
`.env` as an empty assignment (`OTEL_EXPORTER_OTLP_ENDPOINT=`), `source .env`
exports it as an empty string `""`. Zod's `.optional()` accepts `undefined`
but NOT `""` — the schema sees a string and validates it as a URL, which fails:

```
ZodError: OTEL_EXPORTER_OTLP_ENDPOINT — Invalid url
```

Same latent bug exists for `LANGFUSE_HOST`.

## Root Cause B — Next.js "Critical dependency" Warning

`apps/web/next.config.ts` lists `@opentelemetry/sdk-node` in
`serverExternalPackages`, but not `@opentelemetry/instrumentation` or
`require-in-the-middle`. When Next.js transpiles `@rbrasier/adapters` (which
is in `transpilePackages`), it follows the `@opentelemetry/sdk-node` import
chain into `@opentelemetry/instrumentation`, which in turn imports
`require-in-the-middle`. That package uses a dynamic `require()` call that
Next.js cannot statically analyse, producing the critical-dependency warning.

## Fix Plan

1. Add a test `apps/api/src/env.test.ts` asserting that empty-string env vars
   are accepted for optional URL fields without throwing.
2. In `loadEnv()`, strip empty strings to `undefined` before calling
   `envSchema.parse()`.
3. Add `"@opentelemetry/instrumentation"` and `"require-in-the-middle"` to
   `serverExternalPackages` in `apps/web/next.config.ts`.

## Implementation Summary

**`apps/api/src/env.ts`** — `loadEnv()` now maps `process.env` entries through
a transform that converts `""` to `undefined` before calling `envSchema.parse()`.
This handles all optional fields in one place — no per-field changes needed.

**`apps/api/src/env.test.ts`** (new) — 5 tests covering: required fields parse,
empty OTEL endpoint is `undefined`, empty LANGFUSE_HOST is `undefined`, valid URL
is accepted, non-URL string throws.

**`apps/web/next.config.ts`** — added `"@opentelemetry/instrumentation"` and
`"require-in-the-middle"` to `serverExternalPackages`. Next.js no longer attempts
to bundle these packages, eliminating the critical-dependency warning.

## Version Bump

PATCH: `1.0.7` → `1.0.8`
