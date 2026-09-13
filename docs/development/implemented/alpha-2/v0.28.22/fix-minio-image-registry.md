# Bug fix — MinIO can no longer be pulled, so nothing that needs object storage starts

- **Severity**: blocker — a fresh production deploy fails, and CI cannot go green
- **Base branch**: `release/alpha-2`
- **Source issue**: none — found by CI on 13 Sep 2026

## Symptom

Every path that starts MinIO fails at the pull, before the container exists:

```
pull access denied for minio/minio, repository does not exist or
may require 'docker login': denied: requested access to the resource is denied
```

Three places hit it:

| Where | What breaks |
|---|---|
| `.github/workflows/e2e.yml` — *Start MinIO (object storage)* | All three Playwright shards die before a test body runs |
| `docker-compose.prod.yml` — `storage` service | `docker compose up -d` fails for any operator on a fresh deploy |
| `docker-compose.yml` — `storage` service | Local dev and `./validate.sh` cannot reach object storage |

The production compose file is the serious one. The failure is not confined to
this repository's CI: anyone standing up the published v0.28.21 image today
cannot bring the stack up at all.

## Reproduction

```bash
docker compose -f docker-compose.prod.yml up -d     # storage Pulling → Error
docker run --rm minio/minio server /data            # same denial, no compose involved
```

## Root cause, as verified

The MinIO repository was archived in April 2026 — the community edition is now
source-only — and Docker Hub has since removed the `minio` namespace. The image
this repository has always referenced no longer exists at that address.

Probed directly rather than inferred from Docker's error text, which says the
same thing for a missing repository and for a credentials problem:

| Probe | Result |
|---|---|
| `GET hub.docker.com/v2/repositories/minio/minio/` | `404` — `{"message":"object not found"}` |
| anonymous `GET registry-1.docker.io/v2/minio/minio/manifests/latest` | `401 UNAUTHORIZED` |
| same for `minio/mc` | `401 UNAUTHORIZED` |
| `mirror.gcr.io/minio/minio:latest` (Docker Hub pull-through cache) | `404` |
| control — `chrislusf/seaweedfs:latest`, `mirror.gcr.io/library/postgres:latest` | `200` |

The controls matter: they prove the probe method is sound and that Docker Hub
itself is reachable, which is what separates a removed repository from a rate
limit. A rate limit answers `toomanyrequests` and would not spare the controls.

**This is not a regression in this repository.** The E2E suite passed on `main`'s
head (`29a938e`) on 10 September, and the image reference is byte-identical on
`main`, on `release/alpha-2`, and on the open forward-merge branch. Nothing in
the repository changed; the registry did, between 10 and 13 September.

## Fix plan

Point all three call sites at `quay.io/minio/minio`, which is where MinIO's
images are still served, keeping the same tag, command, environment variables,
healthchecks and data path. Nothing about how MinIO runs changes — only where
the image is fetched from.

A regression guard asserts that no compose file or workflow references the dead
Docker Hub address, so a careless revert or a new service copied from an old
block fails in `./validate.sh` rather than in a deployer's terminal.

### Known limitation

`quay.io` is blocked by the network egress policy of the environment this fix was
authored in, so the replacement address could not be verified from here — CI is
the first place it is exercised. If quay is also unusable, the fallback is
`bitnamilegacy/minio`, which is *not* a drop-in: it runs as a non-root user and
keeps its data at `/bitnami/minio/data`, so both compose files and the workflow
would need more than a prefix change.

Because the community edition is archived, these images are frozen rather than
maintained. Restoring the pull address is the fix; choosing a maintained
S3-compatible server is a separate decision and warrants its own ADR.
