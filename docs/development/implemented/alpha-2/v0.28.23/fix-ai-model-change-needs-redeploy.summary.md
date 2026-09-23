# Implementation summary — a saved AI model reaches every process without a redeploy

- **Version**: 0.28.22 → **0.28.23** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: [`fix-ai-model-change-needs-redeploy.md`](./fix-ai-model-change-needs-redeploy.md) (this folder)
- **Source issue**: [#302](https://github.com/rbrasier/wayfinder/issues/302), point 2

## Root cause

`RuntimeConfigStore` cached the AI config for the life of the process, and a
save in Admin → Settings → AI Provider only invalidated the process that handled
it. The `api` worker — which runs Synthesise (extraction) and automated node
jobs with its own store — never saw the change until it restarted, which is
what a redeploy does. Additional web replicas behaved the same way.

## Fix applied

- `packages/adapters/src/config/runtime-config-store.ts` — new
  `AI_CONFIG_CACHE_TTL_MS` (30 s). `getAiConfig()` re-reads the settings row once
  its cached value is older than that, so every process converges on a saved
  model within 30 s. `invalidateAi()` still applies a save immediately on the
  saving process.
- A failed read during a TTL refresh keeps the last good config instead of
  falling back to the environment defaults, so a DB blip cannot silently swap a
  saved model out for 30 s. (Added during the build after an adversarial
  re-read of the diff; the first load still falls back to the environment as
  before.)

## Regression tests added

`packages/adapters/src/config/runtime-config-store.test.ts` — *AI config cache
expiry*, with fake timers:

- serves the cached config without re-reading within the TTL
- re-reads a model saved by another process once the TTL has elapsed (failed before the fix)
- keeps the last good config when a refresh after the TTL fails (failed before the guard)

## E2E

None. Cross-process cache expiry falls in none of the six groups in
`docs/guides/e2e-test-policy.md`; the unit tests above are the guard.

## Known limitations

- Other processes may use the previous model for up to 30 s after a save.
- The other runtime configs (storage, extraction cost ceiling, SIEM, auth,
  banner…) still cache for the life of the process — deliberately out of scope.
