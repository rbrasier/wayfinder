# Upgrading Wayfinder

Wayfinder is distributed as a container image. Upgrading means pointing at a
newer tag and applying any migrations that came with it.

Every published tag is immutable — `0.28.28` is always the same image — so an
upgrade is a deliberate change of version, and a rollback is the same change in
reverse.

---

## The short version

| Deployment | Upgrade |
|---|---|
| Docker Compose | Edit `WAYFINDER_VERSION` in `.env`, then `docker compose -f docker-compose.prod.yml up -d` |
| AWS ECS / Azure Container Apps | Run the `migrate` task on the new image, then roll the `web` and `api` services onto it |

Migrations are safe to run repeatedly, safe to run concurrently, and a no-op
against an already-current database.

> **Upgrading to 0.28.27 or later from an earlier release?** Object storage
> moved from MinIO to SeaweedFS, which cannot read MinIO's data. If you run the
> bundled storage (rather than Amazon S3 or another external store), copy your
> documents across first — see
> [Moving object storage from MinIO to SeaweedFS](#moving-object-storage-from-minio-to-seaweedfs).
> Skip it and uploaded and generated documents will appear to be missing until
> you do; nothing is deleted.

---

## How migrations are applied

Migrations are a **discrete step**, never a side effect of the web app starting
(ADR-047). The image exposes them as a command:

```bash
docker run --rm -e DATABASE_URL="postgresql://…" \
  ghcr.io/rbrasier/wayfinder:0.28.28 migrate
```

It reports what it did and exits `0` on success, non-zero on failure:

```
[migrate] Checking for pending migrations…
[migrate] Applied 3 migration(s) in 412ms (39 were already applied).
```

Three properties make this safe to build an upgrade around:

- **Idempotent.** Running it against a current database prints
  `Database is already up to date` and exits `0`. There is no harm in running it
  when you are not sure whether you need to.
- **Serialised.** Concurrent invocations take a Postgres advisory lock. The
  first applies the migrations; the others wait, then report the database is
  current. A rolling deploy that starts several containers at once still applies
  each migration exactly once.
- **Loud on failure.** A failed migration is a failed step with a non-zero exit
  code and the underlying database error, not a crash-looping web container with
  the real cause buried in application startup logs.

`RUN_MIGRATIONS_ON_START` defaults to `true` so a local checkout needs no
database step, and every deployment artifact sets it to `false`. The container
image sets it for you.

---

## Docker Compose

The migrate service runs to completion on every `up`, and `web` and `api` wait
for it. So the whole upgrade is:

```bash
# 1. Back up first (see below)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U postgres wayfinder | gzip > wayfinder-$(date +%F).sql.gz

# 2. Point at the new version
sed -i 's/^WAYFINDER_VERSION=.*/WAYFINDER_VERSION=0.28.28/' .env

# 3. Pull and restart — migrations run automatically, before the app starts
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Watch it land:

```bash
docker compose -f docker-compose.prod.yml logs migrate
docker compose -f docker-compose.prod.yml ps
```

There is a short interruption while the containers restart. Compose on one host
has no zero-downtime story, which is one of the reasons to move to ECS or
Container Apps once that matters.

---

## AWS ECS and Azure Container Apps

Both run more than one instance, so the order matters: **migrate first, then
roll the services.**

1. **Back up.** Take an RDS snapshot, or an Azure Flexible Server backup. Do this
   before every upgrade that includes a migration.
2. **Run the migrate task on the new image.** On ECS, `aws ecs run-task` with the
   `migrate` command override. On Azure, a Container Apps job with `migrate` as
   its command. Wait for it to exit `0`.
3. **Update both services to the new image tag** and let the platform roll them.
   Update `web` and `api` together — they share every package in `packages/` and
   are built from one image precisely so they cannot drift (ADR-046).
4. **Verify:** the web app answers, and the `api` log reports
   `scheduler heartbeat started`.

Step 2 is not optional busywork you can skip by letting the app migrate itself.
The image sets `RUN_MIGRATIONS_ON_START=false`, so an unmigrated database fails
at the first query rather than being quietly fixed by whichever instance won a
race.

---

## AWS Lambda

The same rule, with a different mechanism: **migrate first, then point traffic at
the new version.** See [`setup-aws-lambda.md`](setup-aws-lambda.md) for the
deployment itself.

1. **Back up.** Take an RDS snapshot. Before every upgrade that includes a
   migration.
2. **Build the web bundle.** `cd deploy/lambda && npm run build:web`. The stack
   packages OpenNext's output, so a stale build deploys stale code silently.
3. **Deploy the stack**, pinning the version you intend to ship. Deploy from a
   checkout at that tag — this target has no published artefact to pin, so the
   git tag is the version.
4. **Invoke the migrate function and confirm it exited cleanly**, before the new
   web function serves traffic:
   ```bash
   aws lambda invoke --function-name Wayfinder-MigrateFunction... /dev/stdout
   ```
5. **Redeploy the always-on SSE service** to the matching image tag. It runs the
   same application and must not drift from the functions.
6. **Verify:** the web app answers, a chat turn streams, and a scheduled session
   fires.

Step 4 is not optional. Nothing here refuses to serve against an unmigrated
schema — the app starts and every query fails — so a skipped migrate has to be a
failed pipeline step rather than something a user finds.

**Zero-downtime caveats.** In-flight session event streams drop when the
always-on service redeploys; browsers reconnect, but an in-progress turn's live
updates are interrupted. Lambda's own rollout is per-invocation, so the web and
api functions cut over without dropping requests.

**Rolling back** follows the general rule below, not a special case. This
deployment target added no schema of its own, so a release carrying no migration
rolls back by redeploying the previous tag. A release that *did* carry one
follows the database-restore path exactly as the container guides do.

---

## Moving object storage from MinIO to SeaweedFS

**Who needs this:** anyone upgrading to 0.28.27 or later from an earlier release
whose documents live in the bundled object storage. If `MINIO_ENDPOINT` points at
Amazon S3, Backblaze B2, Cloudflare R2 or another external store, there is
nothing to move.

**Why:** MinIO archived its community edition and its images can no longer be
pulled, so from 0.28.27 the bundled storage is SeaweedFS. SeaweedFS cannot read
MinIO's on-disk format, so the objects have to be copied across once. Your old
data is not touched by the upgrade: the new release stores into a new
`seaweedfs-data` volume and no longer declares `minio-data`, so even
`docker compose down -v` leaves it alone.

**Before you start**, check the MinIO image is still on the host — it is needed
to read the old data and can no longer be downloaded:

```bash
docker image ls quay.io/minio/minio
```

If it has been pruned, do not delete the `minio-data` volume. Only a MinIO server
can read it, and MinIO's source is still public, so an image can be built from
it.

### Docker Compose

```bash
# 0. Back up the database, as for every upgrade (see "Docker Compose" above).

# 1. Stop the app so nothing writes to storage during the copy.
docker compose -f docker-compose.prod.yml stop web api

# 2. Take the new docker-compose.prod.yml (0.28.27 or later) and start only the
#    new storage. This replaces the MinIO container; its volume is untouched.
docker compose -f docker-compose.prod.yml up -d storage

# 3. Find the names Compose gave the old volume and the network.
docker volume ls --format '{{.Name}}' | grep minio-data    # e.g. wayfinder_minio-data
docker network ls --format '{{.Name}}' | grep _default     # e.g. wayfinder_default
MINIO_VOLUME=wayfinder_minio-data
NETWORK=wayfinder_default

#    Both stores take their credentials from MINIO_ACCESS_KEY / MINIO_SECRET_KEY,
#    so read back exactly what Compose resolved for the new one.
MINIO_ACCESS_KEY=$(docker compose -f docker-compose.prod.yml exec -T storage printenv AWS_ACCESS_KEY_ID)
MINIO_SECRET_KEY=$(docker compose -f docker-compose.prod.yml exec -T storage printenv AWS_SECRET_ACCESS_KEY)
MINIO_BUCKET=$(sed -n 's/^MINIO_BUCKET=//p' .env | tr -d "\"'")
: "${MINIO_BUCKET:=wayfinder-documents}"

# 4. Serve the old data from a temporary MinIO on the same network.
docker run -d --name minio-old --network "$NETWORK" -v "$MINIO_VOLUME":/data \
  -e MINIO_ROOT_USER="$MINIO_ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY" \
  quay.io/minio/minio:latest server /data

# 5. Copy everything across with rclone, then prove every byte arrived.
rc() {
  docker run --rm --network "$NETWORK" \
    -e RCLONE_CONFIG_OLD_TYPE=s3 -e RCLONE_CONFIG_OLD_PROVIDER=Minio \
    -e RCLONE_CONFIG_OLD_ENDPOINT=http://minio-old:9000 \
    -e RCLONE_CONFIG_OLD_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" \
    -e RCLONE_CONFIG_OLD_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY" \
    -e RCLONE_CONFIG_NEW_TYPE=s3 -e RCLONE_CONFIG_NEW_PROVIDER=SeaweedFS \
    -e RCLONE_CONFIG_NEW_ENDPOINT=http://storage:9000 \
    -e RCLONE_CONFIG_NEW_ACCESS_KEY_ID="$MINIO_ACCESS_KEY" \
    -e RCLONE_CONFIG_NEW_SECRET_ACCESS_KEY="$MINIO_SECRET_KEY" \
    rclone/rclone:1.75.1 "$@"
}
rc copy "old:$MINIO_BUCKET" "new:$MINIO_BUCKET"
rc check "old:$MINIO_BUCKET" "new:$MINIO_BUCKET" --one-way --download

# 6. Once check reports "0 differences found", retire the temporary MinIO and
#    bring the whole stack up.
docker rm -f minio-old
docker compose -f docker-compose.prod.yml up -d
```

`copy` never deletes anything, so it is safe to re-run if it is interrupted.
`--download` makes `check` compare file contents rather than checksums: large
uploads are stored in parts, and their checksums cannot be compared across two
different servers.

When you are satisfied everything is there, the old volume can go:

```bash
docker volume rm "$MINIO_VOLUME"
```

### AWS ECS and Azure Container Apps

The same idea, against endpoints rather than a Compose network. While your
existing MinIO is still running, stand up SeaweedFS from the image and command
in `docker-compose.prod.yml`. Then run the `rc copy` and `rc check` above with
`OLD_ENDPOINT` and `NEW_ENDPOINT` pointing at the two stores. Finally, point
`MINIO_ENDPOINT` at SeaweedFS and roll `web` and `api` together.

Copy before anything restarts the MinIO task or app. Its image cannot be
re-pulled unless you have mirrored it into your own registry (ECR or ACR).

---

## Rolling back

Migrations are **forward-only**. There are no down-migrations, so a rollback has
two cases:

- **No migration in the release** — point back at the previous tag and redeploy.
  Nothing else to do.
- **The release included a migration** — restore the database backup taken before
  the upgrade, then point back at the previous tag. Running an older image
  against a newer schema is not supported and will fail in ways that depend on
  what changed.

This is why step 1 is a backup, every time.

---

## Before you upgrade

- **Read the release notes** for the version you are moving to, and for any you
  are skipping. Version numbers are continuous across release lines, so going
  from `0.26.x` to `0.28.28` means you are taking `0.27.x`'s migrations too.
- **Back up `SETTINGS_ENCRYPTION_KEY`** — separately from the database. It
  encrypts every integration credential the setup wizard stored. Restoring a
  database without it leaves those rows unreadable, and every integration has to
  be reconfigured from scratch. It is not rotated by an upgrade; keep the same
  value.
- **Upgrade one version line at a time** if you are far behind. Each step is
  small; a single large jump makes a failure harder to attribute.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Timed out … waiting for another process to finish migrating` | Another migration is running, or an earlier one died holding the lock. Check for idle connections; the lock releases when that session ends |
| `Could not locate the generated migrations` | `MIGRATIONS_DIR` is wrong. The image sets it; you only see this if it was overridden |
| `Caused by: connect ECONNREFUSED` | The migrate step cannot reach the database — check `DATABASE_URL` and network rules before looking at anything else |
| `type "vector" does not exist` | The Postgres instance has no pgvector. On RDS and Flexible Server it must be allow-listed before migrations can create it |
| Web app starts but every query fails | Migrations were never run for this version. Run the `migrate` command |
| `Scheduler enabled but not started` in the api log | `SCHEDULER_TICK_SECRET` is unset, or differs between `web` and `api` |
| Documents missing after upgrading to 0.28.27 or later | Object storage moved to SeaweedFS and the MinIO data was not copied across. Nothing is lost — follow [Moving object storage from MinIO to SeaweedFS](#moving-object-storage-from-minio-to-seaweedfs) |
| `unauthorized` pulling `quay.io/minio/minio` | MinIO's images are no longer served. Upgrade to 0.28.27 or later, which uses SeaweedFS |
