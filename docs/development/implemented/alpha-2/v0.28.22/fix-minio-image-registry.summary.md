# Implementation summary — MinIO is pulled from quay.io, because Docker Hub no longer has it

- **Version**: 0.28.21 → **0.28.22** (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Bug-fix doc**: [`fix-minio-image-registry.md`](./fix-minio-image-registry.md) (this folder)
- **Source issue**: none — found by CI on 13 Sep 2026

## Root cause

The MinIO repository was archived in April 2026 and Docker Hub subsequently
removed the `minio` namespace. `minio/minio` — the address every stack in this
repository has always used — stopped resolving between 10 and 13 September 2026.

Verified by probing the registry rather than reading Docker's error text, which
is identical for a missing repository and a credentials problem: the Docker Hub
API answers `404 object not found` for the repository, an anonymous manifest
request answers `401 UNAUTHORIZED` for both `minio/minio` and `minio/mc`, and
`mirror.gcr.io` — a Docker Hub pull-through cache — cannot serve it either.
Control images (`chrislusf/seaweedfs`, `mirror.gcr.io/library/postgres`) answer
`200`, which is what separates a removed repository from a rate limit; a rate
limit answers `toomanyrequests` and would not spare the controls.

Nothing in the repository regressed. The E2E suite passed on `main`'s head
(`29a938e`) on 10 September, and the image reference is byte-identical on `main`,
on `release/alpha-2`, and on the open forward-merge branch.

## Fix applied

All three call sites now name `quay.io/minio/minio`, where MinIO's images are
still served. Tag, command, environment variables, ports, volumes, data path and
healthchecks are untouched — only the registry the image comes from changed.

- `docker-compose.prod.yml:52` — the `storage` service. The one that mattered: a
  fresh `docker compose -f docker-compose.prod.yml up -d` failed at
  `storage Pulling` for every operator, against the published v0.28.21.
- `docker-compose.yml:21` — the `storage` service used by local dev and `./validate.sh`
- `.github/workflows/e2e.yml:154` — the `docker run` in *Start MinIO (object storage)*

## Regression test added

`packages/adapters/src/storage/minio-image-source.test.ts` — six cases across the
three files that start MinIO, asserting that none names the dead Docker Hub
address and that each still names a MinIO image. It failed on all six before the
fix and passes after.

It guards the address, not the pull: a reverted prefix, or a new service copied
from an old block, now fails in `./validate.sh` rather than in a deployer's
terminal. It deliberately does not reach the network, so it stays a unit test
and cannot flake.

## e2e test

None. The behaviour is which registry a container image comes from, which is not
one of the six groups in [`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md).
The E2E suite is nonetheless the real end-to-end proof here, since it is one of
the three things that was broken — it exercises the new address on this PR.

## Known limitations

- **The replacement address was not verified before pushing.** `quay.io` is
  blocked by the network egress policy of the environment this fix was authored
  in — 403 on CONNECT, for both `curl` and page fetches — so CI is the first
  place `quay.io/minio/minio` is actually pulled. If quay turns out to be
  unusable too, the fallback is `bitnamilegacy/minio`, which is *not* a prefix
  swap: it runs as a non-root user and keeps data at `/bitnami/minio/data`, so
  both compose files and the workflow would need more than one line each.
- **No digest pin.** A digest cannot be read without reaching quay. Less pressing
  than it looks — an archived upstream is not publishing new `latest` — but
  worth doing from a machine that can reach quay, so a future retag cannot break
  CI and every deployer at once the way this did.
- **The images are frozen, not maintained.** The community edition is source-only
  as of April 2026. Restoring the pull address is this fix; choosing a maintained
  S3-compatible server is a separate decision that warrants its own ADR.
