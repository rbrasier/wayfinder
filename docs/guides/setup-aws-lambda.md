# AWS Lambda Deployment

This guide deploys Wayfinder to AWS with **no always-on web or worker compute**.
It is the counterpart to [`setup-aws.md`](setup-aws.md), which runs the same
application on ECS Fargate; the shape below is deliberately the same so you can
move between them.

**Read this before you choose it.** The container path in `setup-aws.md` is the
tested reference deployment — it is what CI builds and smoke-tests on every pull
request. This one is additive (ADR-056). Choose it when the duty cycle makes a
24/7 Fargate pair poor value: a pilot, a demonstration tenant, an organisation
running a handful of sessions a week. Do not choose it if you need air-gapped or
local-model embeddings, which are not available here at all — see §7.

It is also **not fully serverless**. One small always-on service remains, for
the session event stream. That is a deliberate constraint, not a gap to be
patched: §7 explains it, and it is the first thing to weigh.

---

## What Wayfinder actually needs

The same four things as every other platform, plus one Lambda-specific note:

| Need | Why |
|---|---|
| **PostgreSQL 16 with pgvector** | Application data, and the knowledge-base vector index |
| **An S3-compatible object store** | Uploaded documents, templates, generated output |
| **Somewhere to run `web`, and something to tick the workers** | `web` is the Next.js app and the only thing users reach; the scheduler, retention and extraction workers are tick functions, so a schedule can drive them |
| **One public HTTPS origin** | Sign-in callbacks, the first-run `/setup` link, and links in notification emails are all built from it |
| **One always-on service for the session event stream** | The SSE route holds a long-lived Postgres `LISTEN`. On Lambda every open chat tab would pin a billed concurrent execution for up to 15 minutes and then drop. §7 |

---

## 1. Map the pieces to AWS services

| Wayfinder piece | AWS service |
|---|---|
| `web` (Next.js) | Lambda behind a Function URL in `RESPONSE_STREAM` mode, fronted by CloudFront |
| Scheduler tick | EventBridge rule POSTing the web app's existing internal tick endpoint |
| Extraction tick | Lambda on an EventBridge rule (1 minute) |
| Retention sweep | Lambda on an EventBridge rule (daily) |
| `migrate` | One-shot Lambda, invoked by the deploy pipeline before the new version serves |
| **Session events (SSE)** | **A small always-on Fargate or App Runner service**, routed via CloudFront |
| n8n webhook (`/v1/webhooks`) | Lambda running the Express app — the one route with outside ingress |
| PostgreSQL + pgvector | Amazon RDS for PostgreSQL 16, behind RDS Proxy |
| Object storage | Amazon S3 |
| Secrets | AWS Secrets Manager |
| AI provider | Amazon Bedrock, or the Anthropic / OpenAI / Mistral public APIs |
| Embeddings | A hosted provider only (§7) |

**API Gateway is not usable** in front of the web or chat paths. It cannot
stream, and it caps at 30 seconds against a turn that runs to roughly 300. Function
URLs with response streaming are the only viable front door.

The scheduler needs no Lambda of its own. Firing logic already lives behind
`/api/internal/scheduler/tick` on the web app, protected by a shared secret, so
EventBridge POSTs it directly rather than through a function that would only
forward the call.

---

## 2. Prerequisites

The CDK stack in `deploy/lambda` creates the functions, schedules, proxy and
CloudFront distribution. It does **not** create the database, the bucket, or
your secrets — those outlive any one deployment.

### RDS with pgvector

Create a PostgreSQL 16 instance as in [`setup-aws.md` §3](setup-aws.md), then
enable the extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Note two connection strings, not one. You need both:

- the **RDS Proxy** endpoint, for ordinary queries
- the **direct instance** endpoint, for `DATABASE_LISTEN_URL` (§5)

### The S3 bucket and its IAM user

Create the bucket as in [`setup-aws.md` §4](setup-aws.md). One thing differs
from what you may expect: **the storage adapter signs with a static access key
pair, not the function's execution role.** Create an IAM user with access to the
bucket and store its keys in Secrets Manager. Granting the execution role S3
access is not sufficient on its own.

### Secrets Manager

Create secrets for the database credentials, the direct `LISTEN` URL, the
scheduler tick secret, and the application secrets (`BETTER_AUTH_SECRET`,
`SETTINGS_ENCRYPTION_KEY`, provider API keys). The stack reads their ARNs.

### The always-on SSE service

Deploy the published container image as a small Fargate or App Runner service
running the `web` command, with no public ingress of its own. CloudFront routes
`/api/sessions/*/events` to it. One task is enough — this service carries only
open event streams.

---

## 3. Deploy the stack

```bash
cd deploy/lambda
npm install                 # its own lockfile; do not run pnpm here
npm run build:web           # OpenNext build — required, and easy to forget
npx cdk bootstrap           # once per account and region
npx cdk deploy
```

The stack reads its inputs from the environment:

```bash
export CDK_DEFAULT_ACCOUNT=...          CDK_DEFAULT_REGION=eu-west-2
export WAYFINDER_VPC_ID=vpc-...
export WAYFINDER_DATABASE_SECRET_ARN=arn:aws:secretsmanager:...
export WAYFINDER_DATABASE_INSTANCE_ID=wayfinder-db
export WAYFINDER_DATABASE_LISTEN_URL_SECRET_ARN=arn:aws:secretsmanager:...
export WAYFINDER_DOCUMENTS_BUCKET=wayfinder-documents
export WAYFINDER_APPLICATION_SECRET_ARN=arn:aws:secretsmanager:...
export WAYFINDER_SCHEDULER_TICK_SECRET_ARN=arn:aws:secretsmanager:...
export WAYFINDER_PUBLIC_BASE_URL=https://wayfinder.example.com
```

### Run migrations before the web function serves traffic

This ordering is the whole reason migrations are a discrete command (ADR-047):

```bash
aws lambda invoke --function-name Wayfinder-MigrateFunction... /dev/stdout
```

Invoke it and **check that it succeeded** before pointing traffic at the new
version. Wayfinder does not refuse to serve against an unmigrated schema — it
starts, and then every query fails. A skipped migrate must be a failed pipeline
step, not something a user discovers.

The migrate function is safe to run repeatedly and safe to run concurrently:
instances serialise on a Postgres advisory lock, and an already-current database
is a no-op.

---

## 4. Environment variable mapping

The stack sets most of these. This is what they mean and which ones you must
supply.

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | RDS **Proxy** endpoint | Set by the stack |
| `DATABASE_LISTEN_URL` | **Direct** instance endpoint | The `LISTEN` subscription needs session mode, which RDS Proxy does not provide |
| `EMBEDDINGS_PROVIDER` | `openai` | Mandatory here — see §7 |
| `MINIO_BUCKET` | Your bucket name | The adapter speaks S3; the name is historical |
| `MINIO_REGION` | The bucket's region | Required on real S3 |
| `MINIO_PATH_STYLE` | `false` | Path style is a MinIO-ism; real S3 signs virtual-hosted style |
| `MINIO_USE_SSL` | `true` | |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | The IAM user's keys | Not the execution role |
| `SCHEDULER_TICK_SECRET` | A shared secret | The same value on the web function and in the EventBridge connection |
| `BETTER_AUTH_URL` | Your public origin | No trailing slash |
| `SETTINGS_ENCRYPTION_KEY` | 64 hex chars | `openssl rand -hex 32` |

`RUN_MIGRATIONS_ON_START` does not apply here. It is read by the `start` script,
and OpenNext invokes the Next.js server handler directly, so that script never
runs. Migrations are the discrete step in §3 and nothing else.

---

## 5. First login and verification

Open your CloudFront domain. A fresh database lands on `/setup`, where you
create the first administrator and configure storage, the AI provider and mail —
exactly as in [`setup-aws.md` §9–10](setup-aws.md).

Then verify the pieces that are specific to this topology:

1. **A chat turn streams.** Tokens should appear progressively, not in one
   block. If the response arrives all at once, the Function URL is not in
   `RESPONSE_STREAM` mode.
2. **The session event stream stays open.** Open a chat and leave it. If it
   drops after a few minutes, CloudFront is routing `/api/sessions/*/events` to
   the web Lambda instead of the always-on service.
3. **A scheduled session fires.** Create one a few minutes out and confirm it
   advances — that proves the EventBridge connection is reaching the tick
   endpoint with the right secret.
4. **An extraction batch completes.** Upload a small batch and watch the `x of y`
   counter move.
5. **Admin → Settings → RAG Embeddings** shows the local provider **disabled**.
   That is correct here, and it is how you know the deployment knows what it is.

---

## 6. Cost shape

The point of this topology is that idle time is nearly free. What that leaves:

- **The always-on SSE service** is the floor. It bills continuously regardless of
  use.
- **Every open chat tab pins a billed concurrent execution** on that service for
  as long as it stays open. This is the cost that surprises people. Ten users
  with a tab open all day is ten concurrent connections all day.
- **Cold starts** are real. The first request after idle pays the bundle load;
  the web function is the largest.
- **RDS and RDS Proxy** bill continuously. Neither scales to zero.
- **Cache misses cost database reads.** See §7.

---

## 7. Constraints you are accepting

These are properties of the topology, not defects awaiting a fix. Every one of
them is a reason someone should choose the container path instead.

### The session event stream needs always-on compute

`/api/sessions/[sessionId]/events` holds a long-lived connection backed by a
Postgres `LISTEN` subscription. Lambda's execution ceiling is 15 minutes, after
which the connection drops regardless of what the client is doing, and each warm
instance holds its own `LISTEN` connection.

Hence the hybrid. Making Wayfinder fully serverless means replacing the event bus
adapter and changing the browser's `EventSource` — a separate piece of work, not
a configuration option.

### Hosted embeddings only

This deployment ships without `onnxruntime-node`, which is what keeps cold starts
sane and allows a zip-based artefact. `EMBEDDINGS_PROVIDER` must be `openai` (or
a Bedrock embeddings adapter).

The application knows this about itself. The local option is **disabled** in
Admin → Settings, and the server rejects it even if the request is made
directly — so a well-meaning administrator cannot switch the deployment onto a
provider it cannot load.

**Air-gapped and local-model deployments must use the container path.** There is
no way to run them here.

### Rate limits become per-instance

`InMemoryRateLimiter` is process-scoped. Across Lambda instances the effective
ceiling is `configured limit × concurrent instances`. Set the configured limit
accordingly, and treat it as a guard rail rather than a hard bound.

The same applies to the LLM concurrency semaphore, which stops bounding total
in-flight calls against your provider's rate limits. Budget enforcement is
unaffected — it is database-backed.

### Cache hit rates fall

The auth and permission caches barely warm across cold instances, so per-request
database reads are higher than on a container. Size the database with that in
mind; this topology hits that pressure earlier than a long-lived process does.

### Background extraction runs on a slower cadence

The worker's default tick is 5 seconds; EventBridge's floor is 60. An operator
watching a run is unaffected — the run screen drives the batch engine itself —
but a run left unattended drains roughly twelve times more slowly than on a
container.

### The connection budget is real

Lambda concurrency multiplied by pool size will exhaust RDS without a proxy,
which is why the stack puts one in front. The `LISTEN` connection is the
exception and must bypass it.

---

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Chat responses arrive in one block, not progressively | The Function URL is in `BUFFERED` mode; it must be `RESPONSE_STREAM` |
| Chat streams cut off after about 15 minutes | The SSE route is being served by Lambda. Route `/api/sessions/*/events` to the always-on service |
| `LISTEN` fails, or session events never arrive | `DATABASE_LISTEN_URL` is pointing at the proxy. It must use the direct instance endpoint — RDS Proxy has no session mode |
| `remaining connection slots are reserved` under load | Functions are bypassing RDS Proxy, or the pool size per instance is too high for your concurrency ceiling |
| Web app answers but every query fails | Migrations were never run for this version. Invoke the migrate function (§3) |
| Scheduled sessions never fire | The EventBridge connection's `x-scheduler-secret` does not match `SCHEDULER_TICK_SECRET` on the web function |
| Embedding calls fail with "not available in this deployment" | The stored provider is `local`, which this artefact cannot load. Switch to a hosted provider in Admin → Settings, then re-index |
| The local embeddings option is greyed out | Correct and expected. See §7 |
| First request after idle is slow | Cold start. Provisioned concurrency on the web function trades cost for latency |
| `cdk deploy` fails on a missing asset directory | `npm run build:web` was not run, so there is no OpenNext output to package |
| Storage test fails with a signing or region error | Set `MINIO_PATH_STYLE=false` and `MINIO_REGION` to the bucket's region |

---

## Alternatives

- **ECS Fargate** — [`setup-aws.md`](setup-aws.md). The tested reference
  deployment, and the right default unless the duty cycle argues otherwise.
- **EC2 with Docker Compose** — the smallest footprint: one instance running
  `docker-compose.prod.yml`. Fine for a pilot, but you own patching and backups.
- **Azure Container Apps** — [`setup-azure.md`](setup-azure.md).
