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

23 new tests, all passing. `./validate.sh` passes 25/0.

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

## Known limitations

- **The CDK stack and OpenNext packaging have not been deployed.** They are
  typechecked and linted, and every AWS construct was verified against
  `node_modules` — `InvokeMode.RESPONSE_STREAM`, `Runtime.NODEJS_22_X`,
  `events.Connection`/`ApiDestination`, `FunctionUrlOrigin`, OpenNext's output
  layout. That is not the same as a working deployment. `pdf-parse` resolution
  inside the bundle, cold-start times and the CloudFront behaviours are proven by
  a real deploy, which this environment cannot do. Phase §13's end-to-end
  criterion remains **outstanding** and must be run against a throwaway stack
  before this target is recommended to anyone.
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
