# Forward merge: `release/alpha-3` (PR #405) into `main` (v0.41.12)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md) and `/release`
Operation C. Shipped as a patch bump (0.41.11 → 0.41.12) so the merge-back can be
traced like a bugfix.

## What came across

Everything on `release/alpha-3` since the previous forward merge (v0.41.11,
PR #403, which took the release line up to PR #371):

| Release-line change | Release PR | Release version | Trace doc on `release/alpha-3` |
|---|---|---|---|
| **Dependency advisories** (Dependabot #94–#102): pnpm override floors raised to `hono >=4.13.16` and `@hono/node-server >=2.1.6`; `deploy/lambda` moves to `aws-cdk-lib` ^2.278.0 and `@opennextjs/aws` ^4.2.0, removing the vulnerable `minimatch` copies and the `glob@9` chain; `scripts/lockfile-advisories.test.mjs` gains the new floors and drops its two exceptions | #405 | 0.41.10 | [`alpha-3/v0.41.10/dependabot-hono-minimatch-advisories.bugfix.md`](../../alpha-3/v0.41.10/dependabot-hono-minimatch-advisories.bugfix.md) |
| **Object storage client swap**: the `minio` npm client is replaced by `@aws-sdk/client-s3` behind `IObjectStorage` (`S3ObjectStorageAdapter`, `s3ClientOptions`; the storage health probe uses the same client). `minio`, `stream-json`, `query-string`, `decode-uri-component` and `fast-xml-parser` leave the tree, along with the `query-string` pnpm patch and its overrides. `MINIO_*` env vars and the MinIO server are unchanged | #405 | 0.41.10 | Same doc, "Addendum — minio client replaced" |
| **Dockerfile**: the build stage no longer copies the removed `patches/` directory | #405 | 0.41.10 | Same doc |
| **Deployment guides pinned to v0.41.10** (`setup-aws.md`, `setup-azure.md`, `upgrading.md`) | — (direct commit) | 0.41.10 | — |

The release line's trace doc comes across unchanged, in the place it was written.
This file is the record of the merge on `main`.

## Integrity of `main`

Since PR #403, `main` had changed only by that forward merge itself, so git merged
the release branch with no conflicts. Root `package.json` auto-merged: `main`'s
version line was kept and the release line's override and `patchedDependencies`
changes applied. Checked against `main`:

- **Migrations.** None in this range. The journal is unchanged, so
  `release-line-reconciliation.ts` needs no entry and the note in v0.41.11 still
  holds (the next migration on `main` is numbered after 0063).
- **No stale references.** No code on `main` still imports `minio`,
  `MinioStorageAdapter`, `minioClientOptions` or `patches/`. Remaining mentions of
  `MinioStorageAdapter` are in the original PRD and ADR-009, which record past
  decisions and are left as written. The `to-be-implemented/` phase that mentions
  object storage (`scaling-new-infrastructure.phase.md`) was already updated to
  `S3ObjectStorageAdapter` by #405.
- **ADR / PRD numbering.** No new ADRs or PRDs, so nothing can collide.
- **Behaviour.** The storage swap keeps the `IObjectStorage` contract and the
  `MINIO_*` configuration, so deployments upgrade with no config change.
  `s3-object-storage.test.ts` and `s3-client-options.test.ts` replace the minio
  adapter tests.

## Deliberately not taken

Nothing. Every commit applies to `main` as it is.

## Version

0.41.11 → **0.41.12** (patch, as asked for a merge-back). `main` stays above the
release line's 0.41.10. `VERSION` and `package.json` match.
