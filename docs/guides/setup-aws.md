# AWS Deployment

This guide deploys Wayfinder to AWS on **ECS Fargate**, with RDS for Postgres and
S3 for object storage. It is the AWS counterpart to
[`setup-railway.md`](setup-railway.md); the shape of the deployment is the same,
but you assemble the pieces yourself instead of adding plugins.

For a container-free path, see [Alternatives](#alternatives) at the end.

---

## What Wayfinder actually needs

Four things, whatever the platform:

| Need | Why |
|---|---|
| **PostgreSQL 16 with pgvector** | Application data, and the knowledge-base vector index |
| **An S3-compatible object store** | Uploaded documents, templates, generated output |
| **Two Node processes** — `web` and `api` | `web` is the Next.js app and the only thing users reach; `api` is a long-lived Express server that also runs the scheduler, retention and extraction workers |
| **One public HTTPS origin** | Sign-in callbacks, the first-run `/setup` link, and links in notification emails are all built from it |

---

## 1. Map the pieces to AWS services

| Wayfinder piece | AWS service |
|---|---|
| `web` (Next.js, port 3000) | ECS Fargate service behind an Application Load Balancer |
| `api` (Express + workers, port 3001) | ECS Fargate service, no public ingress |
| PostgreSQL + pgvector | Amazon RDS for PostgreSQL 16 |
| Object storage | Amazon S3 |
| Secrets | AWS Secrets Manager (or SSM Parameter Store) |
| TLS + DNS | AWS Certificate Manager + Route 53 |
| Logs | CloudWatch Logs (`awslogs` driver) |
| AI provider | Amazon Bedrock, or the Anthropic / OpenAI / Mistral public APIs |

`web` never calls `api`. The traffic goes the other way: `api`'s scheduler
heartbeat POSTs the web app's internal tick endpoint at `WEB_BASE_URL`. So `api`
needs egress to `web`, not ingress from the internet — unless you use the n8n
callback webhook (`/v1/webhooks`), which is the one route an outside caller hits.

---

## 2. Get the container image

Wayfinder publishes a container image, so there is nothing to build:

```
ghcr.io/rbrasier/wayfinder:0.28.11
```

It is public — no credential, no `imagePullSecret`. One image contains both
processes; the ECS task definition picks which one runs by setting the command
(`web`, `api` or `migrate`). Pin the version rather than using `latest`, so a
scale-out event can never pull a different build than the one you tested.

**Optional: mirror it into ECR.** Pulling from GHCR works, but a copy in ECR
gives you lower pull latency, no cross-internet egress on every scale-out, and
scanning in your own account:

```bash
AWS_REGION=eu-west-2
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/wayfinder"

aws ecr create-repository --repository-name wayfinder --region "$AWS_REGION"
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

docker pull ghcr.io/rbrasier/wayfinder:0.28.11
docker tag ghcr.io/rbrasier/wayfinder:0.28.11 "$REPO:0.28.11"
docker push "$REPO:0.28.11"
```

**Air-gapped or egress-restricted?** The published image fetches the local
embedding model on first use. To avoid that, build your own from the repo's
`Dockerfile` with the model vendored in:

```bash
docker build --build-arg VENDOR_EMBEDDINGS_MODEL=true -t wayfinder:offline .
```

then set `EMBEDDINGS_ALLOW_REMOTE_MODELS=false` at runtime.

## 3. Create the database

An RDS for PostgreSQL **16** instance, private subnets, not publicly accessible.

- pgvector is available on RDS PostgreSQL 16 with no parameter-group change; the
  first migration runs `CREATE EXTENSION vector`, which the master user is
  allowed to do.
- RDS enforces TLS when `rds.force_ssl=1` (the default on newer parameter
  groups), so put `?sslmode=require` on the connection string.
- Create the database itself (`wayfinder`) before the first deploy — the
  migrations create tables, not the database.

```
DATABASE_URL=postgresql://wayfinder:PASSWORD@wayfinder.abc123.eu-west-2.rds.amazonaws.com:5432/wayfinder?sslmode=require
```

**Sizing the pool.** Each process opens its own pool, so keep
`DATABASE_POOL_MAX × (web tasks + api tasks)` comfortably under the instance's
`max_connections`. The default is `10` per process.

**If you put RDS Proxy in front**, note that the session event bus uses Postgres
`LISTEN/NOTIFY`, which needs a session-mode connection. Point `DATABASE_URL` at
the proxy and `DATABASE_LISTEN_URL` at the instance's direct endpoint.

## 4. Create the S3 bucket

Create `wayfinder-documents` in the same region, with public access blocked and
default encryption on.

The storage adapter is an S3 API client that signs with a **static key pair** —
it does not use the task role's credentials. Create an IAM user for it and attach:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::wayfinder-documents"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::wayfinder-documents/*"
    }
  ]
}
```

Add `s3:CreateBucket` only if you want the app to create the bucket on first
start instead of creating it yourself.

## 5. Store the secrets

Put these in Secrets Manager and inject them into both task definitions via the
container definition's `secrets` block, so they never appear in plaintext in the
task definition:

| Secret | Generate with |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `SCHEDULER_TICK_SECRET` | `openssl rand -hex 32` |
| Database password | RDS-managed, or your own |
| `MINIO_SECRET_KEY` | The IAM user's secret access key |

**Back up `SETTINGS_ENCRYPTION_KEY`.** It encrypts the integration credentials
the setup wizard stores. Lose it and those rows become unreadable, and every
integration has to be reconfigured from scratch.

`SCHEDULER_TICK_SECRET` must be the **same value on both services**. Without it
the API logs `Scheduler enabled but not started` and scheduled sessions never
fire.

## 6. Environment variable mapping

[`.env.min.example.prod`](../../.env.min.example.prod) in the repo root is the
smallest working set for a deployment, with each value explained. On AWS:

| Wayfinder variable | Value | Set on |
|---|---|---|
| `NODE_ENV` | `production` | both |
| `DATABASE_URL` | RDS endpoint, `?sslmode=require` | both |
| `DATABASE_POOL_MAX` | `10`, sized against `max_connections` | both |
| `BETTER_AUTH_SECRET` | From Secrets Manager | web |
| `SETTINGS_ENCRYPTION_KEY` | From Secrets Manager | both |
| `BETTER_AUTH_URL` | Your public origin, e.g. `https://wayfinder.example.com` — no trailing slash | web |
| `WEB_BASE_URL` | The same origin (or the internal address the API reaches web on) | api |
| `SCHEDULER_TICK_SECRET` | From Secrets Manager, same value on both | both |
| `ADMIN_SEED_EMAIL` | Optional — pre-fills and binds the admin email on `/setup` | web |
| `WEB_PORT` / `API_PORT` | `3000` / `3001` (defaults) | web / api |

Object storage and the AI provider are **normally configured in the setup
wizard**, not here — the wizard tests each connection before accepting it and
stores the credentials encrypted. Set them in the environment only for an
env-only install:

| Wayfinder variable | Value for Amazon S3 |
|---|---|
| `MINIO_ENDPOINT` | `s3.<region>.amazonaws.com` |
| `MINIO_PORT` | `443` |
| `MINIO_USE_SSL` | `true` |
| `MINIO_REGION` | `<region>` — S3 signs with the bucket's region; left blank the client spends a `GetBucketLocation` call per bucket and fails outright without that permission |
| `MINIO_PATH_STYLE` | `false` — S3 wants virtual-hosted addressing; only MinIO needs `true` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | The IAM user's key pair |
| `MINIO_BUCKET` | `wayfinder-documents` |

| Wayfinder variable | Value for Amazon Bedrock |
|---|---|
| `AI_DEFAULT_PROVIDER` | `bedrock` |
| `AWS_BEDROCK_REGION` | Region with your model access enabled |
| `AWS_BEDROCK_ACCESS_KEY_ID` / `AWS_BEDROCK_SECRET_ACCESS_KEY` | An IAM user granted `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream` |

All three Bedrock values must be set together — the provider is treated as
unconfigured unless region, key id and secret are all present. Request model
access in the Bedrock console first; a new account has none by default.

## 7. Define the ECS services

Two task definitions off the same image, both on Fargate with `awslogs` to
CloudWatch:

| | `web` | `api` |
|---|---|---|
| Command | `web` | `api` |
| Port | 3000 | 3001 |
| Behind the ALB | yes | no |
| Suggested size | 1 vCPU / 2 GB | 0.5 vCPU / 1 GB |
| Desired count | ≥ 1 | ≥ 1 |

Give both tasks a security group that can reach RDS on 5432, and `api` egress to
the ALB so its heartbeat can reach `WEB_BASE_URL`.

**Run migrations as their own task, before rolling the services.** The image
sets `RUN_MIGRATIONS_ON_START=false`, so the web task never migrates on boot —
a migration is a discrete step that either succeeds or fails visibly, rather
than something several tasks race to do during a rolling deploy:

```bash
aws ecs run-task --cluster wayfinder --task-definition wayfinder-web \
  --overrides '{"containerOverrides":[{"name":"web","command":["migrate"]}]}'
```

It is safe to re-run — an already-current database is a no-op — and safe to run
concurrently, since instances serialise on an advisory lock. Wait for it to exit
`0` before updating the services. See
[`upgrading.md`](upgrading.md) for the full upgrade sequence.

**Scaling `api` is safe.** The scheduler, retention and extraction workers claim
work with `FOR UPDATE SKIP LOCKED`, so concurrent ticks never double-fire.

## 8. Front it with an ALB

- Internet-facing ALB, HTTPS listener on 443 with an ACM certificate, HTTP
  redirecting to HTTPS.
- Target group → the `web` service on port 3000.
- Health check path `/`, success codes `200-399` — the root redirects to sign-in
  when unauthenticated. There is no dedicated health route on `web`; the `api`
  service has `GET /health`, which reports the system health of Postgres and
  storage if you expose it internally for monitoring.
- Chat responses stream over Server-Sent Events. The app sends a keepalive every
  `SSE_HEARTBEAT_MS` (default 25 s), which is inside the ALB's 60 s default idle
  timeout. If you raise the heartbeat, raise the idle timeout to stay ahead of it.
- Point a Route 53 record at the ALB, and use that hostname for `BETTER_AUTH_URL`.

## 9. First login

Navigate to your HTTPS origin. On first boot with no admin, the app prints a
`https://your-host/setup?token=…` link to the `web` task's CloudWatch log stream —
open it, create the administrator, and complete the setup wizard (object storage,
AI provider, sign-in method).

If `ADMIN_SEED_EMAIL` is set, the setup screen pre-fills it and only that address
may create the admin.

For sign-in by magic link in production, configure a real email transport — see
the `SMTP_*` and `M365_*` variables in [`.env.example`](../../.env.example).

## 10. Verify

- Log in as admin
- Navigate to **Admin → Flows** — you should see the empty state
- Upload a test document template via a `generate_document` node
- Check the S3 bucket — the file should appear under `templates/`
- Check the `api` task's log for `scheduler heartbeat started`

---

## Alternatives

- **App Runner** builds from source and manages TLS and scaling for you, which is
  closer to the Railway experience. It reads a single `apprunner.yaml` at the repo
  root, so running both `web` and `api` from one repo means either a container
  image per service or a second config path — at which point ECS is simpler.
- **EC2 with Docker Compose** is the smallest possible footprint: one instance
  running the repo's `docker-compose.prod.yml`, which brings up web, api, Postgres
  and MinIO off the same published image. Fine for a pilot, but you own patching,
  backups and TLS.
- **Elastic Beanstalk** on the Node platform works, but the pnpm workspace build
  needs custom `.platform` hooks and you still need Postgres and S3 separately.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Task exits immediately with a `SETTINGS_ENCRYPTION_KEY` error | The value must be 64 hex chars or a base64-encoded 32-byte value — `openssl rand -hex 32` |
| `no pg_hba.conf entry … no encryption` | Add `?sslmode=require` to `DATABASE_URL` |
| `type "vector" does not exist` | The migration could not create the extension — connect as the RDS master user, or run `CREATE EXTENSION vector;` by hand |
| Sign-in redirects to `localhost:3000` | `BETTER_AUTH_URL` is unset or still the default — it must be the public origin, with no trailing slash |
| `Scheduler enabled but not started` in the api log | `SCHEDULER_TICK_SECRET` is unset; set the same value on both services |
| Scheduled sessions still never fire | The api cannot reach `WEB_BASE_URL` — check egress from the api security group to the ALB |
| Storage test fails with a signing or region error | On real S3 set `MINIO_PATH_STYLE=false` and `MINIO_REGION` to the bucket's region |
| Web app starts but every query fails | Migrations were never run for this version — run the `migrate` command (see [`upgrading.md`](upgrading.md)) |
| `Timed out … waiting for another process to finish migrating` | Another migration is running, or one died holding the lock — check for idle database connections |
| Chat streams cut off after a fixed interval | ALB idle timeout is below `SSE_HEARTBEAT_MS`; raise the timeout or lower the heartbeat |
