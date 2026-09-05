# Implementation Summary — AWS Lambda Deployment Target

- **Version**: 0.34.0 — **MINOR** (new capability, no schema impact)
- **Date**: 2026-09-05
- **Phase doc**: [`lambda-deployment-target.phase.md`](./lambda-deployment-target.phase.md)
- **Decision record**: ADR-056 — Lambda Is a Second Deployment Topology, Not a Replacement

## What was built

An AWS Lambda deployment target with no always-on web or worker compute, for
pilots and low-duty-cycle tenants. The container image remains the reference
deployment; this is additive, and CI now proves the container path is unaffected
rather than asserting it.

The framework needed no restructuring. The workers were already tick functions,
migrations were already a discrete command, storage already spoke S3, and
`buildApp` was already a pure builder. Three changes landed inside the existing
tree, and two of them fix gaps that were latent before this phase.

## Files created

**`deploy/lambda/` — outside the pnpm workspace, with its own lockfile**

| File | Purpose |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.mjs`, `cdk.json`, `.gitignore` | Standalone toolchain — the root scripts are all `turbo run` and cannot see this directory |
| `handlers/container.ts` | One api container per execution environment, memoised across warm invocations |
| `handlers/api.ts` | `buildApp(container)` behind `@codegenie/serverless-express` |
| `handlers/tick.ts` | Shared tick logic: register the job once per environment, then tick every worker |
| `handlers/tick.test.ts` | 6 tests |
| `infra/wayfinder-lambda-stack.test.ts` | 12 CDK synth assertions |
| `handlers/handlers.integration.test.ts` | 7 tests against a real Postgres |
| `vitest.config.ts`, `vitest.integration.config.ts`, `test-fixtures/` | Unit and integration runs kept separate |
| `handlers/tick-extraction.ts`, `handlers/tick-retention.ts` | EventBridge entrypoints |
| `handlers/migrate.ts` | The ADR-047 migrate command as a one-shot |
| `infra/app.ts` | CDK app; every input names infrastructure created outside the stack |
| `infra/wayfinder-lambda-stack.ts` | Functions, EventBridge rules and API destination, RDS Proxy, S3 assets, Function URLs, CloudFront |
| `README.md` | Why this is not a workspace package, and what is not verified |

**Elsewhere**

- `apps/api/src/workers.ts` + `workers.test.ts` — 8 tests
- `packages/adapters/src/ai/settings…` → probe added to `local-embeddings-adapter.ts`
- `apps/web/src/server/routers/settings-embeddings.ts`
- `apps/web/src/components/settings/embeddings-provider-state.ts` + test — 9 tests
- `docs/guides/setup-aws-lambda.md`
- `docs/development/adr/056-lambda-as-a-second-deployment-topology.adr.md`

## Files modified

| File | Change |
|---|---|
| `apps/api/src/index.ts` | Reduced to wiring: it now calls `startWorkers` / `stopWorkers` instead of starting three worker loops as import side effects |
| `packages/adapters/src/ai/local-embeddings-adapter.ts` | Added `isLocalEmbeddingsAvailable`, a resolution probe over `@huggingface/transformers` and `onnxruntime-node` |
| `packages/adapters/src/ai/embeddings-adapter.ts` | `DispatchingEmbeddingsAdapter` takes optional availability checks and fails fast with `INFRA_FAILURE`; production wiring passes the probe |
| `apps/web/src/server/routers/settings.ts` | `getEmbeddingsConfig` returns provider availability; `setEmbeddingsConfig` rejects an unloadable provider with `PRECONDITION_FAILED` |
| `apps/web/src/components/settings/rag-embeddings-card.tsx` | Options are rendered from the server's availability list; an unloadable provider is disabled, and a stored-but-unloadable provider raises a warning |
| `.dockerignore` | Excludes `deploy` |
| `.github/workflows/ci.yml` | New `deploy-lambda` job; `compose-smoke` now asserts the api listened and started both default-on workers |
| `docs/guides/setup-aws.md` | Lambda cross-link in Alternatives |
| `docs/guides/upgrading.md` | New AWS Lambda section |
| The *Scaling With New Infrastructure* phase doc | The two "never serverless" statements corrected |
| `VERSION`, `package.json` | 0.33.0 → 0.34.0 |

## Migrations

**None.** No schema change, so no generated migration and no `-- data-impact:`
declaration. This is why the rollback story for this target is a redeploy.

## Tests

42 new tests, all passing. `./validate.sh` passes 25/0.

| Test file | Covers |
|---|---|
| `apps/api/src/workers.test.ts` | Every worker starts, the exact log lines are preserved, toggles are honoured, the scheduler's no-worker warning, and start failures logged not thrown |
| `packages/adapters/src/ai/local-embeddings-adapter.test.ts` | The probe is true when both packages resolve, false when either is missing |
| `packages/adapters/src/ai/embeddings-adapter.test.ts` | Fails fast with `INFRA_FAILURE`, dispatches normally when available, and a provider with no declared check stays available |
| `apps/web/src/server/routers/settings.test.ts` | Availability options and the rejection reason |
| `apps/web/src/components/settings/embeddings-provider-state.test.ts` | Selectability, blocked reason, stored-provider warning, and the not-yet-loaded case |
| `deploy/lambda/handlers/tick.test.ts` | Registers once per environment, retries after a failed registration, ticks every worker, warns when none is wired |

**No Playwright e2e spec was written.** No part of this phase falls into the six
groups in [`e2e-test-policy.md`](../../../guides/e2e-test-policy.md): the admin
control is component logic, the availability guard is an adapter concern, and
the api bootstrap is a unit. Group 6 (smoke) is carried by `ci.yml`'s
`compose-smoke` job, which this phase extended rather than duplicated.

## Deviations from the approved change summary

1. **`§5.4` — on-upload extraction invocation was dropped: it already exists.**
   Pre-flight found `run-progress.tsx:61` already driving `extraction.tick` in a
   loop while a run is live, with a comment naming this exact case. Four in-tree
   changes became three. The phase doc's §5.4 and §7.4 were corrected in place.
2. **No `handlers/web.ts`.** The phase doc listed one. OpenNext takes no handler
   entry file — it builds from a stock `next build` and emits its own bundle at
   `apps/web/.open-next/server-functions/default/index.mjs`, which the stack
   packages directly. Verified against `@opennextjs/aws@3.10.4`. §4.2 corrected.
3. **`@codegenie/serverless-express` pinned to 4.x, not 5.x.** v5 requires Node
   ≥ 24; this repo targets Node 20 (`node:20-bookworm-slim`, `engines`).
4. **The embeddings helpers were extracted to `settings-embeddings.ts`.** Adding
   them inline pushed `settings.ts` from 723 to 748 lines, over `validate.sh`'s
   700-line warn threshold. The directory already had the `settings-*.ts` sibling
   pattern; settings.ts finished at 725, a net +2.
5. **`compose-smoke` asserts two workers, not three.** `RETENTION_ENABLED`
   defaults to `false` — retention is opt-in — so asserting its log line would
   assert a non-default. The job now checks `listening on`,
   `scheduler heartbeat started` and `extraction worker started`.

## Deployment testing beyond unit tests

Added after the first pass, on the question of how a deployment target is tested
at all. Two tiers now run on every pull request, inside the existing
`deploy-lambda` job.

**Tier 1 — CDK synth assertions** (`infra/wayfinder-lambda-stack.test.ts`, 12
tests, ~8s). Synthesises the stack once in `beforeAll` and asserts against the
finished template: response streaming on the web Function URL, the RDS Proxy,
`EMBEDDINGS_PROVIDER=openai` and `MINIO_PATH_STYLE=false` on every function, the
schedule expressions, the scheduler's API destination and its `x-scheduler-secret`
header, and both CloudFront behaviours.

**It found a real bug on its first run.** `rds.DatabaseInstance.fromDatabaseInstanceAttributes`
cannot be used as a proxy target without an explicit `engine` — synth failed with
`CouldNotDetermineEngineForProxyTarget`. That would have failed at `cdk deploy`,
which is the first thing an operator would have done. Fixed by passing the
engine, and the instance endpoint is now a stack prop
(`WAYFINDER_DATABASE_ENDPOINT`) rather than being read out of the secret.

Synth also bundles all four handlers with esbuild (~7.3 MB each), so the
deployment artefact is proven to build on every PR.

**Tier 2 — handler integration tests** (`handlers/handlers.integration.test.ts`,
7 tests, ~6s) against a real Postgres. The migrate handler applies the full
schema (48 tables, pgvector included) and is idempotent; both tick handlers
register their job and record a run in `job_registry`; the api handler answers a
Function URL request through Express. These prove what a fake container cannot.

Time efficiency, since the job runs on every PR:

| Decision | Saving |
|---|---|
| Extend the existing `deploy-lambda` job rather than adding one | ~90s — no second workspace install |
| `cache: pnpm` on `setup-node`, restoring the store the `validate` job populated | ~40–60s |
| Postgres only — the api container never calls `objectStorage.initialise()` and postgres.js connects lazily | ~15s, one fewer service |
| The migrate handler *is* the schema setup — no separate `drizzle-kit` step | ~15–25s, and it turns setup into a test |
| One synth shared across all 12 assertions via `beforeAll` | 77s → 8s |
| Cheapest checks first: typecheck, lint, unit, then integration | fails fast |

Measured locally: typecheck 12.5s, lint 2.9s, unit + synth 8.7s, integration
5.7s, audit ~1s — **about 30 seconds of compute**, of which tier 2 adds ~6s.

Integration tests never skip themselves when the database is absent; they fail.

## Testing the other deployment paths

The Lambda work exposed an asymmetry: it is the only deployment with
infrastructure as code in the repo, so it is the only one with a template to
assert against. ECS, Azure Container Apps, Railway and EC2 are prose guides over
one shared artefact — the published image and its three entrypoint commands.
That makes the image the place to test them, and `compose-smoke` the job that
covers all four at once.

**Six assertions added to `compose-smoke`**, each pinning a decision an ADR named
as the risky part and none of which had a test:

| Assertion | Decision it pins |
|---|---|
| `RUN_MIGRATIONS_ON_START=false` in the image | ADR-047 Consequences: *"the main thing to get right in review"* — its correct production value is the opposite of its default |
| No `.env` in the image | ADR-046 §4 / ADR-041 |
| No `deploy/` in the image | ADR-056 §2, and this phase's own acceptance criterion, previously unasserted |
| `/app/VERSION` matches the repo's `VERSION` | ADR-046: the build context must contain it or the About modal silently reports the wrong version |
| The `migrate` entrypoint target exists, and an unknown command still execs verbatim | `docker-entrypoint.sh`'s documented contract, which every container guide tells operators to use |
| No non-comment runtime path references `drizzle-kit` | ADR-047 §3, the claim the whole ADR rests on |

**`validate.sh` section 25 — deployment guide env coverage.** Prose guides have no
template to synthesise, so the static analogue is drift: every variable the zod
schemas require must appear in every `setup-*.md`. Delegated to
`scripts/check-guide-env-coverage.mjs`, mirroring how section 11 delegates to
`scripts/audit-check.sh`. It finds nothing today — three required variables
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`), all documented
in all five guides. Its value is that adding a required variable can no longer
silently invalidate five guides at once. A `setup-*.md` that is neither listed as
a deployment guide nor explicitly excluded also fails, so a new provider forces
the decision rather than defaulting to uncovered.

Two bugs were caught while building these, both by probing rather than by
reading:

- The checker's first version used `$` under the `m` flag as its entry
  terminator. `$` matches end-of-line there, so every multi-line schema entry was
  truncated to its first token and lost the `.optional()` below it — eight
  variables were falsely reported as required.
- Its guide match used `includes()`, so a guide mentioning
  `SETTINGS_ENCRYPTION_KEY_RENAMED` counted as documenting
  `SETTINGS_ENCRYPTION_KEY`. A deliberate negative test — rename a variable in a
  guide and confirm the check fails — did not fail, which is how it was found.
  Now bounded by non-identifier characters on both sides.

The `drizzle-kit` assertion would also have failed on its first CI run:
`scripts/migrate-if-configured.sh:27` names drizzle-kit in a comment explaining
that it deliberately does not call it. Comments are now excluded, matching the
convention `validate.sh` section 23 already used.

**Not run here.** The six image assertions need Docker, which this environment
does not have. Their shell is syntax-checked and every premise was verified
against the repo — the Dockerfile line, both `.dockerignore` entries, the
entrypoint's paths, and the drizzle-kit grep simulated against the real tree —
but CI is the first place they execute.

## Known limitations

- **The CDK stack and OpenNext packaging still have not been deployed.** Tier 1
  proves the stack synthesises and every handler bundles; tier 2 proves the
  handlers run against a real database. Neither proves `pdf-parse` *resolves at
  runtime* inside the bundle, cold-start latency, response streaming surviving
  CloudFront end-to-end, RDS Proxy behaviour under concurrency, or that the
  always-on SSE service is routed correctly. Phase §13's end-to-end criterion
  remains **outstanding** and must be run against a throwaway stack before this
  target is recommended to anyone.
- **The topology is hybrid.** One always-on service remains for the session event
  stream. An operator expecting scale-to-zero will find one service that does
  not.
- **Air-gapped and local-model deployments cannot use this target**, and now fail
  loudly rather than obscurely.
- **In the hybrid, the two halves could disagree about local-embeddings
  availability** — the always-on service runs the container image and can load
  it. This stays theoretical because CloudFront routes only the SSE path there,
  so `/admin` is always Lambda-served. Documented in the guide rather than
  relied upon.
- `deploy/lambda` installs with `--legacy-peer-deps`: npm 10.9.7's peer
  resolution crashes on vitest 4.x's optional peer set.

## Version bump

**MINOR**: 0.33.0 → 0.34.0. A new deployment capability with no schema change.
