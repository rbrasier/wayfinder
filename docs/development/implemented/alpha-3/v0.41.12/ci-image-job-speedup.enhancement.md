# Enhancement — Faster container image CI job (v0.41.12)

- **Source**: maintainer request, after "Build container image" became the slowest
  check on PR #408 (no issue)
- **Base**: `release/alpha-3`, on `enhance/ci-image-job-speedup/claude-rbrasier`
- **Version**: PATCH 0.41.11 → 0.41.12 (0.41.11 was taken by Dependabot PR #408, merged first)

## Approved change summary

The Compose stack smoke test moves into the "Build container image" job, so it
runs against the image that job just built and scanned. Trivy's database and SBOM
files are kept out of the Docker build context, so the -slim build reuses the
cache and the -slim image is actually slim. Together these should take about
10–13 minutes off the slowest CI path, and published images should match the ones
`publish.yml` scanned.

### Business rules
- **Smoke test placement:** when CI runs, the compose smoke assertions run as steps
  of `docker-image`, after the CVE scan and before the -slim build. There is no
  separate `compose-smoke` job, and no second image build.
- **Same image:** the smoke test runs the image built with `SECURITY_REFRESH`, the
  one the scan passed. The old job rebuilt it without that build argument.
- **Build context:** `.cache/`, `trivy_envs.txt`, `trivyignores`, `*.cdx.json` and
  `trust/` are excluded from the Docker build context.

## Why — what the job log showed

On run 45583560274 (PR #408) the `Build -slim image` step took 8 minutes even though
`runtime` is built `FROM runtime-slim`, so every -slim layer should already have
been cached:

- `COPY . .` missed the cache and `pnpm build` ran again (131 s), followed by a
  45 s `COPY --from=build` and 235 s to export and load the image.
- The cause: trivy-action stores its vulnerability database in
  `$GITHUB_WORKSPACE/.cache/trivy`, which sits inside the build context and was not
  in `.dockerignore`. The first scan wrote it, so the second build's context differed.
- The job's own size report confirmed it: `wayfinder:ci` was 3667 MiB and
  `wayfinder:ci-slim` 6469 MiB. The -slim image was carrying the Trivy database.

`publish.yml` runs in the same order: build, scan and SBOM, then build and push. So
the images it pushes were most likely rebuilt rather than reused, and carried the
same files. This change fixes that too, through `.dockerignore`; `publish.yml`
itself is unchanged.

A second source showed up on this PR's first CI run, once the smoke test ran in
the same job: `docker-compose.prod.yml` bind-mounts `./trust`, which is not in the
repository, so `docker compose up` creates an empty `trust/` in the checkout. That
also changed the build context. `./trust` holds deployment config (the signer CA
certificates an operator mounts), and the image creates `/app/trust` itself, so it
is excluded too.

The second CI run showed the -slim image back to its expected size (3188 MiB against
3668 MiB for the full image), but `COPY . .` still missed. trivy-action's
entrypoint merges the `trivyignores` input into `./trivyignores` in the workspace,
another file written between the two builds, so it is excluded as well.

## Implementation

- `.github/workflows/ci.yml`: the `compose-smoke` job is removed. Its job-scoped
  environment and all its steps move into `docker-image`, between the main Trivy
  scan and `Build -slim image`. The main build also tags
  `ghcr.io/rbrasier/wayfinder:ci`, the name `docker-compose.prod.yml` runs.
- `.dockerignore`: excludes `.cache`, `trivy_envs.txt`, `trivyignores`, `*.cdx.json` and
  `trust`,
  with the reason recorded alongside.
- `VERSION`, `package.json`: 0.41.12.

## Tests

- **Unit:** none. Neither file is code; the CI run on this PR is the test.
- **E2E:** none. This is a CI-only change, outside the six policy groups.
- **Verification:** on this PR's CI run, `Build -slim image` should show `COPY . .`
  as `CACHED` with no `pnpm build`, and `Report image sizes` should show -slim
  smaller than the full image.

## Deviations

- **Fix 2 replaced (approved in the change summary).** The request was to give the
  -slim build a `cache-to`. That would not help, because the misses come from the
  build context, not a missing cache. Writing to the default `gha` scope would also
  overwrite the full image's cache entry. The `.dockerignore` fix replaces it.
- No separate phase doc or `/doc-review` pass: a two-file CI change, recorded here
  instead, as for v0.41.7.

## Follow-up for the maintainer

- If branch protection on `main` or `release/*` lists **Compose stack smoke test**
  as a required check, remove it. That check no longer reports, and its assertions
  now run inside **Build container image**.
