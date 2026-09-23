# Bug fix — a saved AI model is ignored by the background worker until redeploy

- **Severity**: major — an admin's model choice silently fails to apply to Synthesise and automated steps
- **Base branch**: `release/alpha-2`
- **Source issue**: [#302](https://github.com/rbrasier/wayfinder/issues/302), point 2 ("AWS model selection")

## Symptom

An admin changes models in **Admin → Settings → AI Provider**, sees "AI
configuration saved", but runs keep using the previous model. Only a redeploy
makes the change stick.

## Reproduction

1. Run the production stack (`docker-compose.prod.yml`: `web` and `api` as separate processes).
2. Start a Synthesise (extraction) run — the `api` worker loads and caches the AI config.
3. Save a different model in Admin → Settings → AI Provider.
4. Start another Synthesise run — it still calls the old model. Restarting `api` fixes it.

## Root cause, as verified

`RuntimeConfigStore.getAiConfig()`
(`packages/adapters/src/config/runtime-config-store.ts`) caches the AI config
for the life of the process. The only way to refresh it is `invalidateAi()`,
which `settings.setAiConfig` (`apps/web/src/server/routers/settings.ts`) calls
on the **one** process that handled the save.

The `api` worker builds its own `RuntimeConfigStore` and `LanguageModelAdapter`
(`apps/api/src/container.ts`) and runs `ProcessExtractionTask` (Synthesise) and
automated node jobs with them. Nothing ever invalidates that cache, so it keeps
the model it first read until the process restarts — which a redeploy does. The
same applies to any additional web replica.

The triage comment on #302 reached the same mechanism but cited a
`deploy/lambda/handlers/container.ts` that does not exist in this repository;
the web/api process split in the shipped compose file is the concrete case.

There are no model environment variables (`buildEnvAiConfig` always uses
`DEFAULT_MODELS_FOR`), so "changing the config" cannot have been what fixed it —
the redeploy's restart was.

This contradicts ADR-041 (DB-first configuration, no redeploy to reconfigure).

## Fix plan

- Give the AI config cache a 30-second time-to-live: a cached value older than
  `AI_CONFIG_CACHE_TTL_MS` is re-read from the settings repository on the next
  call. Every process converges on the saved model within 30 s.
- Keep `invalidateAi()` so the saving process still applies it immediately.
- Regression tests in `runtime-config-store.test.ts` with fake timers: the cache
  is served within the TTL and re-read after it.
- Other runtime configs keep their current caching (out of scope).

## Approved change summary

Saving a new AI model in Admin → Settings → AI Provider reaches every running
process within about 30 seconds instead of waiting for the next redeploy. The
in-memory AI config cache gains a 30-second time-to-live so each process re-reads
the saved setting; the process that handled the save still applies it
immediately. Points 1 (Synthesise Publish) and 3 (branding) of #302 are split
into their own feature issues.

- **Version**: 0.28.22 → 0.28.23 (PATCH)
- **Branch**: `claude/issue-302-bugfix-yopdn8` from `release/alpha-2`, PR against `release/alpha-2`
- **Tests**: unit regression tests in `runtime-config-store.test.ts`; no e2e — cross-process cache expiry is outside the six `e2e-test-policy.md` groups
- **Out of scope**: TTLs on the other runtime configs; cross-process push invalidation
