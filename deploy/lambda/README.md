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
npm test
npm run audit          # this lockfile is invisible to scripts/audit-check.sh

npm run build:web      # OpenNext build — required before deploy
npx cdk deploy         # see the guide for the environment it expects
```

## What is not verified here

The CDK stack and the OpenNext packaging have been typechecked and linted, and
every AWS construct used was verified against `node_modules`. **They have not
been deployed.** `pdf-parse` resolution inside the bundle, cold-start times and
the CloudFront behaviours are proven by a real deployment, not by this
directory's checks. The container path remains the tested reference deployment
(ADR-056 §1).
