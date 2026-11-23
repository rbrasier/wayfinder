# Bug fix — hono, @hono/node-server, fast-xml-parser and minimatch advisories (Dependabot #94–#102)

## Approved change summary

Every one of the 9 alerts gets fixed on `release/alpha-3`:

- **Root workspace:** raised pnpm override floors take `hono` to 4.13.16 or later, `@hono/node-server` to 2.1.6 or later, and `fast-xml-parser` to 5.12.0 or later.
- **`deploy/lambda`:**
  - `@opennextjs/aws` goes from 3.10.4 to 4.2.0. Its minifier (`@node-minify` 10) uses `fast-glob`, so `glob@9` and its vulnerable `minimatch` 8 drop out of the tree.
  - `aws-cdk-lib` goes to 2.278.0. That release bundles a patched `minimatch` 11.
- **Regression test:** `scripts/lockfile-advisories.test.mjs` gets the new floors and loses both exceptions added in v0.41.1, so it fails before the fix.

`stream-json` was first left out, because forcing v3 breaks `minio` as soon as it loads. After the PR opened, the maintainer asked to replace the `minio` client package with `@aws-sdk/client-s3` in this same PR. That removes `stream-json` entirely (see "Addendum — minio client replaced").

## Advisories

| Alert | Advisory | Package | Lockfile | Affected | Patched |
|---|---|---|---|---|---|
| #94 | GHSA-g3hv-75wg-m249 | minimatch | `deploy/lambda/package-lock.json` | `>=7.0.0 <11.0.1` | 11.0.1 |
| #95 (Low) | GHSA-474x-hrwr-fgx4 | fast-xml-parser | `pnpm-lock.yaml` | `<=5.11.2` | 5.12.0 |
| #96 | GHSA-jpvv-r467-5p4w | @hono/node-server | `pnpm-lock.yaml` | `>=2.0.0 <2.1.6` | 2.1.6 |
| #97 | GHSA-qv5m-9pm6-hqp3 | @hono/node-server | `pnpm-lock.yaml` | `>=2.0.0 <2.1.6` | 2.1.6 |
| #98 | GHSA-h7mg-cq63-vhpq | hono | `pnpm-lock.yaml` | `>=4.1.4 <=4.13.15` | 4.13.16 |
| #99 | GHSA-4h7h-rv7c-7m2v | hono | `pnpm-lock.yaml` | `>=4.5.1 <=4.13.15` | 4.13.16 |
| #100 (Low) | GHSA-3gg2-335m-rxc6 | hono | `pnpm-lock.yaml` | `>=3.12.0 <=4.13.15` | 4.13.16 |
| #101 | GHSA-4m76-xfj5-7975 | hono | `pnpm-lock.yaml` | `<4.13.16` | 4.13.16 |
| #102 | GHSA-46wx-v44x-9hh2 | hono | `pnpm-lock.yaml` | `<4.13.16` | 4.13.16 |

The minimatch chain also triggers npm audit's GHSA-3g3m-2fjr-6pw4 on `glob` `>=9.0.0 <=14.0.1`.

## Root cause (verified)

- **hono, @hono/node-server and fast-xml-parser:**
  - All three are transitive. The existing pnpm overrides set floors of `hono >=4.13.7` and `@hono/node-server >=2.1.3`, which were the patched versions for earlier advisories. The lockfile still resolves `hono@4.13.13` and `@hono/node-server@2.1.5`, so the floors are below the new fixes.
  - `fast-xml-parser@5.8.0` comes through `minio@8.0.7`, which asks for `^5.3.4`. No override pins it, and the lockfile has not been regenerated since.
- **minimatch in `deploy/lambda`:** two copies sit inside the advisory range. v0.41.1 left both as documented exceptions.
  - **10.2.5, bundled inside `aws-cdk-lib@2.273.0`:** npm overrides cannot reach bundled copies. `aws-cdk-lib@2.278.0` bundles `minimatch ^11.0.9`.
  - **8.0.7, under `glob@9.3.5`:** this comes through `@opennextjs/aws@3.10.4` → `@node-minify/core@8.0.6`. Overriding it breaks `glob@9`, as v0.41.1 showed. `@opennextjs/aws@4.2.0` depends on `@node-minify/core@^10.5.0`, whose utils use `fast-glob`, so the whole `glob@9` chain disappears.

## Reproduction

1. On `release/alpha-3` at 0.41.9, run `pnpm audit`. It lists five hono advisories, two `@hono/node-server` advisories and one `fast-xml-parser` advisory.
2. In `deploy/lambda`, run `npm audit`. It lists `minimatch` (GHSA-g3hv-75wg-m249) through `aws-cdk-lib` and `glob`.

## Fix plan

1. **Regression test first:** extend `scripts/lockfile-advisories.test.mjs` with floors for hono, `@hono/node-server`, fast-xml-parser and glob. Remove the `glob@9` path exception and the skip for bundled copies. It must fail on the current lockfiles.
2. **Root `package.json`:**
   - `hono` → `>=4.13.16 <5`;
   - `@hono/node-server` → `>=2.1.6 <3`;
   - add `fast-xml-parser` → `>=5.12.0 <6`.
3. **`deploy/lambda/package.json`:** `aws-cdk-lib` → `^2.278.0`, `@opennextjs/aws` → `^4.2.0`.
4. **Verify OpenNext v4:** run a real `open-next build` of `apps/web`, then synth the CDK stack against that real output.
5. **Version:** bump PATCH to 0.41.10.

## Known limitations

- None remaining. `pnpm audit` and `npm audit` in `deploy/lambda` both report no vulnerabilities.

## Implementation summary (v0.41.10)

- **Root cause:**
  - The pnpm override floors for `hono` and `@hono/node-server` sat below the new fixes.
  - `fast-xml-parser` had no floor at all.
  - In the lambda lockfile, the vulnerable `minimatch` copies (bundled in `aws-cdk-lib`, and under `glob@9` through `@opennextjs/aws@3`) could not be overridden, only removed by upstream releases. Those releases now exist.
- **Fix applied:**
  - **Root `pnpm.overrides`:**
    - `hono` `>=4.13.16 <5` resolves to 4.13.21;
    - `@hono/node-server` `>=2.1.6 <3` resolves to 2.1.11;
    - `fast-xml-parser` `>=5.12.0 <6` resolves to 5.12.1.

    The lockfile diff is limited to those three packages and their own dependencies.
  - **`deploy/lambda`:** `aws-cdk-lib` `^2.278.0` and `@opennextjs/aws` `^4.2.0`.
    - `glob`, `minimatch` 8 and `@node-minify` 8 leave the tree.
    - The bundled `minimatch` becomes 11.0.9.
    - OpenNext v4 also moves its pinned `esbuild` from 0.25.4 to 0.28.2.
    - `npm audit` reports 0 vulnerabilities.
- **OpenNext v4 verification:**
  - A real `open-next build` of `apps/web` completes.
  - It produces the same `server-functions/default` (handler `index.handler`) and `assets` layout.
  - The CDK stack test suite passes 13/13 when pointed at that real output instead of the fixtures.
  - Lambda typecheck, lint and unit tests pass (19 tests).
- **Regression test:** `scripts/lockfile-advisories.test.mjs`, run by `validate.sh` section 11e.
  - **New floors:** hono, `@hono/node-server`, fast-xml-parser and glob.
  - **Removed:** the `glob@9` path exception and the skip for bundled copies.
  - It failed 2 of 3 cases before the fix, naming the 6 vulnerable copies, and passes 3 of 3 after.
- **E2E:** none. No user-facing behaviour changed, and the lockfile test is the guard.
- **Deviations from the first summary:**
  - At the approval gate the maintainer asked to include the `@opennextjs/aws` 3 → 4 jump, and it was included.
  - After the PR opened, the maintainer asked to replace the `minio` client package in this PR (below).

## Addendum — minio client replaced with `@aws-sdk/client-s3`

- **Why:**
  - `stream-json` (GHSA-528h-pc64-c93x, -hqr4-qq8f-hg3x and -mjw6-4jj6-33hc) reached the workspace only through the `minio` npm client. The patched 3.6+ line is ESM-only and renamed `jsonl/Parser.js`, which `minio@8.0.7` requires as soon as it loads, so an override was impossible.
  - The client sat behind the `IObjectStorage` interface and was used in only two files, so swapping it is contained.
- **What changed:**
  - **New adapter:** `S3ObjectStorageAdapter` (`packages/adapters/src/storage/s3-object-storage.ts`) replaces `MinioStorageAdapter`. It uses the same six operations, mapped onto `HeadBucket`, `CreateBucket`, `PutObject`, `GetObject`, `DeleteObject` and `HeadObject`.
  - **Client settings:** `s3ClientOptions` replaces `minioClientOptions`. Path style maps onto `forcePathStyle`.
  - **Region:** the SDK needs a region to sign, so a blank region falls back to `us-east-1`, with `followRegionRedirects` so Amazon S3 can correct it per bucket. A configured region outside `us-east-1` is sent as the bucket's `LocationConstraint` when the bucket is created.
  - **Health probe:** the storage probe uses the same S3 client. Its injected factory is renamed from `MinioClientFactory` to `StorageClientFactory`.
  - **Wiring:** both containers (`apps/web`, `apps/api`) construct the new adapter.
- **Removed with `minio`:**
  - `stream-json`, `query-string`, `decode-uri-component` and `fast-xml-parser`. The AWS SDK no longer uses `fast-xml-parser`.
  - The `query-string@7.1.3` patch from v0.41.1, and the `decode-uri-component` and `fast-xml-parser` overrides, which had nothing left to act on. The lockfile-advisory test keeps their floors, so they would be caught if a dependency brought them back.
- **Unchanged:**
  - The MinIO server in Docker and in CI. It speaks S3.
  - The `MINIO_*` environment variables, which name the server, not the client.
- **Verification:**
  - **Unit tests:** `s3-client-options.test.ts` (5 tests) and `s3-object-storage.test.ts` (14 tests) were written first and failed until the adapter existed.
  - **Live check:** a full round trip ran against a live S3-compatible endpoint (moto server; `dl.min.io` is blocked in this sandbox). It covered the probe, an idempotent `initialise`, exists, NOT_FOUND, put, get and delete.
  - **Build and validate:** `next build` of `apps/web` passes, `./validate.sh` passes and `pnpm audit` reports no known vulnerabilities.
