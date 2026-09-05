# `deploy/lambda`

AWS Lambda entrypoints and a CDK stack for Wayfinder.

**Read [`docs/guides/setup-aws-lambda.md`](../../docs/guides/setup-aws-lambda.md) first.**
This directory is the machinery; that guide is the deployment.

## Why this is not a workspace package

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `mocks`. A package under
`apps/` would be pulled into the workspace automatically and would break the
Docker build for **every other provider**: the `Dockerfile` copies each
workspace manifest by name, and a member present in the lockfile but absent from
that COPY list fails `pnpm install --frozen-lockfile`. It would also ship CDK
inside the published image.

So this directory sits outside all three globs, with its own `package.json` and
its own lockfile. See ADR-056 §2 for the full reasoning.

Two consequences follow, and both are obligations rather than conveniences:

- **`deploy` is in `.dockerignore`.** Placement keeps the *dependencies* out of
  the image; that line keeps the *source* out.
- **Nothing at the repo root checks this directory.** `pnpm lint`, `typecheck`
  and `test` are all `turbo run` and cannot see it. The `deploy-lambda` job in
  `.github/workflows/ci.yml` is what catches a handler drifting against
  `container.ts`, and it is required, not optional.

## Layout

```
handlers/
  container.ts          one api container per execution environment
  api.ts                buildApp(container) behind serverless-express
  tick.ts               shared tick logic — registers the job, then ticks
  tick-extraction.ts    ExtractionWorker.tick()
  tick-retention.ts     RetentionWorker.tick()
  migrate.ts            the ADR-047 migrate command, one-shot
infra/
  app.ts                    CDK app; every input names existing infrastructure
  wayfinder-lambda-stack.ts functions, schedules, RDS Proxy, CloudFront
```

Handlers import the repo's own code through relative paths, deliberately: `tsc`
then resolves exactly what the bundler will, so `npm run typecheck` is a real
drift check rather than a formality.

**There is no `web.ts`.** OpenNext builds the Next.js app from a stock
`next build` and emits its own server bundle, which the stack consumes from
`apps/web/.open-next/server-functions/default`. That is why OpenNext was chosen
over the Lambda Web Adapter, which needs `output: "standalone"` and would change
the web build for every provider.

## Commands

```bash
npm install            # own lockfile; do not run pnpm here
npm run typecheck      # the drift check
npm run lint
npm test               # unit tests + CDK synth assertions
npm run audit          # this lockfile is invisible to scripts/audit-check.sh

npm run build:web      # OpenNext build — required before deploy
npx cdk deploy         # see the guide for the environment it expects
```

Integration tests need a live Postgres with pgvector and are a separate script,
so a bare `npm test` stays infrastructure-free:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=wayfinder_lambda pgvector/pgvector:pg16

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/wayfinder_lambda \
  npm run test:integration
```

They do not skip themselves when the database is missing — they fail, which is
the point. There is no separate migration step: the migrate handler *is* the
schema setup, so the deployment's own migration path is what prepares the
database.

## What the checks prove, and what they do not

**Proven here, on every pull request:**

- The handlers compile against the current `container.ts` — the drift check.
- The stack synthesises, and its shape is asserted: response streaming on the
  web Function URL, the RDS Proxy, hosted embeddings pinned on every function,
  `MINIO_PATH_STYLE=false`, the schedule expressions, the scheduler's API
  destination, and the CloudFront behaviours.
- **Every handler bundles.** Synth runs esbuild over all four, so a dependency
  that cannot be bundled fails the build rather than the deployment.
- The handlers run against a real Postgres: the migrate handler applies the full
  schema and is idempotent, both tick handlers register their job and record a
  run in `job_registry`, and the api handler answers a Function URL request
  through Express.

**Not proven here — a real deployment is the only way:**

- `pdf-parse` reads its own package files at *runtime*. Synth proves it bundles;
  only an invocation proves it resolves.
- Cold-start latency, and whether response streaming survives CloudFront
  end-to-end.
- RDS Proxy behaviour under concurrency, and the connection budget.
- That the always-on SSE service is routed correctly.

The container path remains the tested reference deployment (ADR-056 §1).
