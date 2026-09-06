# Azure Deployment

This guide deploys Wayfinder to Azure on **Container Apps**, with Azure Database
for PostgreSQL Flexible Server. It is the Azure counterpart to
[`setup-railway.md`](setup-railway.md); the shape of the deployment is the same,
but you assemble the pieces yourself instead of adding plugins.

One thing does not map cleanly — object storage. Read
[§4](#4-provide-object-storage) before you start.

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

## 1. Map the pieces to Azure services

| Wayfinder piece | Azure service |
|---|---|
| `web` (Next.js, port 3000) | Container App with external ingress |
| `api` (Express + workers, port 3001) | Container App with internal ingress |
| PostgreSQL + pgvector | Azure Database for PostgreSQL Flexible Server 16 |
| Object storage | MinIO on Container Apps, or an external S3-compatible store — see §4 |
| Container images | Azure Container Registry |
| Secrets | Azure Key Vault, referenced as Container Apps secrets |
| TLS + DNS | Container Apps managed certificate, or Azure Front Door |
| Logs | Log Analytics (the Container Apps environment's default) |
| Sign-in | Microsoft Entra ID — natively supported, see §8 |
| AI provider | Anthropic, OpenAI, Mistral or Amazon Bedrock — see §6 |

`web` never calls `api`. The traffic goes the other way: `api`'s scheduler
heartbeat POSTs the web app's internal tick endpoint at `WEB_BASE_URL`, which is
why `api` can sit on internal ingress. The one route an outside caller hits is
the n8n callback webhook (`/v1/webhooks`), if you use it.

---

## 2. Get the container image

Wayfinder publishes a container image, so there is nothing to build:

```
ghcr.io/rbrasier/wayfinder:0.28.17
```

It is public — no registry credential and no pull secret on the Container App.
One image contains both processes; each Container App picks which one runs by
setting the command (`web`, `api` or `migrate`). Pin the version rather than
using `latest`, so a scale event can never pull a different build than the one
you tested.

**Optional: import it into ACR.** Pulling from GHCR works, but a copy in ACR
gives lower pull latency, no cross-internet egress on every scale event, and
scanning in your own subscription:

```bash
RG=wayfinder-rg
ACR=wayfinderacr

az group create --name "$RG" --location uksouth
az acr create --resource-group "$RG" --name "$ACR" --sku Basic
az acr import --name "$ACR" \
  --source ghcr.io/rbrasier/wayfinder:0.28.17 \
  --image wayfinder:0.28.17
```

`az acr import` copies registry-to-registry — no local Docker, and nothing
transits your machine.

**Air-gapped or egress-restricted?** The published image fetches the local
embedding model on first use. To avoid that, build your own from the repo's
`Dockerfile` with the model vendored in — `az acr build` does it in Azure:

```bash
az acr build --registry "$ACR" --image wayfinder:offline \
  --build-arg VENDOR_EMBEDDINGS_MODEL=true .
```

then set `EMBEDDINGS_ALLOW_REMOTE_MODELS=false` at runtime.

## 3. Create the database

An Azure Database for PostgreSQL **Flexible Server**, version 16.

**pgvector needs allowlisting.** Flexible Server only loads extensions named in
the `azure.extensions` server parameter, so the first migration fails with
`extension "vector" is not allow-listed` until you add it:

```bash
az postgres flexible-server parameter set \
  --resource-group "$RG" --server-name wayfinder-db \
  --name azure.extensions --value VECTOR
```

Then create the database and note the connection string. TLS is enforced by
default, so include `?sslmode=require`:

```
DATABASE_URL=postgresql://wayfinder:PASSWORD@wayfinder-db.postgres.database.azure.com:5432/wayfinder?sslmode=require
```

**Sizing the pool.** Each process opens its own pool, so keep
`DATABASE_POOL_MAX × (web replicas + api replicas)` comfortably under the
server's `max_connections`. The default is `10` per process.

**If you enable the built-in PgBouncer**, note that it pools in transaction mode
while the session event bus uses Postgres `LISTEN/NOTIFY`, which needs a
session-mode connection. Point `DATABASE_URL` at the pooler port (6432) and
`DATABASE_LISTEN_URL` at the direct port (5432).

## 4. Provide object storage

**Azure Blob Storage will not work directly.** The storage adapter speaks the S3
API, and Blob Storage does not expose an S3-compatible endpoint. Pick one of:

| Option | When it fits |
|---|---|
| **MinIO as a third Container App**, with an Azure Files volume mount for `/data` | You want everything inside Azure. Give it internal ingress on port 9000, set `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` as secrets, and point `MINIO_ENDPOINT` at its internal FQDN with `MINIO_PATH_STYLE=true`. Note that MinIO on a network file share is slower than on a managed disk |
| **MinIO on an Azure VM with a managed disk** | Better throughput and a simpler durability story than Azure Files, at the cost of a VM to patch |
| **An external S3-compatible store** — Amazon S3, Cloudflare R2, Backblaze B2 | Least operational work. Accept the cross-cloud egress and the data-residency implications |

Whichever you choose, the credentials are a static key pair and the settings are
best entered in the setup wizard, which tests the connection before accepting it.

## 5. Store the secrets

Hold these in Key Vault and reference them as Container Apps secrets (via the app's
managed identity), so they are never inline in the container app definition:

| Secret | Generate with |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `SETTINGS_ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `SCHEDULER_TICK_SECRET` | `openssl rand -hex 32` |
| Database password | Your own |
| `MINIO_SECRET_KEY` | Your object store's secret key |

**Back up `SETTINGS_ENCRYPTION_KEY`.** It encrypts the integration credentials
the setup wizard stores. Lose it and those rows become unreadable, and every
integration has to be reconfigured from scratch.

`SCHEDULER_TICK_SECRET` must be the **same value on both apps**. Without it the
API logs `Scheduler enabled but not started` and scheduled sessions never fire.

## 6. Environment variable mapping

[`.env.min.example.prod`](../../.env.min.example.prod) in the repo root is the
smallest working set for a deployment, with each value explained. On Azure:

| Wayfinder variable | Value | Set on |
|---|---|---|
| `NODE_ENV` | `production` | both |
| `DATABASE_URL` | Flexible Server endpoint, `?sslmode=require` | both |
| `DATABASE_POOL_MAX` | `10`, sized against `max_connections` | both |
| `BETTER_AUTH_SECRET` | Key Vault reference | web |
| `SETTINGS_ENCRYPTION_KEY` | Key Vault reference | both |
| `BETTER_AUTH_URL` | Your public origin, e.g. `https://wayfinder.example.com` — no trailing slash | web |
| `WEB_BASE_URL` | The same origin, or the web app's internal Container Apps FQDN | api |
| `SCHEDULER_TICK_SECRET` | Key Vault reference, same value on both | both |
| `ADMIN_SEED_EMAIL` | Optional — pre-fills and binds the admin email on `/setup` | web |
| `WEB_PORT` / `API_PORT` | `3000` / `3001` (defaults) | web / api |

Object storage and the AI provider are **normally configured in the setup
wizard**, not here — the wizard tests each connection before accepting it and
stores the credentials encrypted. Set them in the environment only for an
env-only install; the `MINIO_*` variables are in
[`.env.example`](../../.env.example) with each value explained.

**On the AI provider:** the supported providers are `anthropic`, `openai`,
`mistral` and `bedrock`. **Azure OpenAI is not one of them** — the provider
registry has no endpoint override, so an Azure OpenAI resource cannot be used as
a drop-in for `openai`. Either call the public Anthropic/OpenAI/Mistral APIs, or
add Azure OpenAI as a provider following
[`adding-a-provider.md`](adding-a-provider.md) — it is a small, self-contained
change to the registry in `packages/adapters/src/ai/providers.ts`.

## 7. Create the Container Apps

One environment, two apps off the same image:

| | `web` | `api` |
|---|---|---|
| Command | `web` | `api` |
| Target port | 3000 | 3001 |
| Ingress | External | Internal |
| Suggested size | 1 vCPU / 2 GB | 0.5 vCPU / 1 GB |
| Min replicas | **1** | **1** |

```bash
az containerapp create \
  --name wayfinder-web --resource-group "$RG" --environment wayfinder-env \
  --image "$ACR.azurecr.io/wayfinder:$(cat VERSION)" \
  --target-port 3000 --ingress external --min-replicas 1 --max-replicas 3 \
  --command pnpm --args "--filter,@wayfinder/web,start"
```

**Set `--min-replicas 1` on `api`, not 0.** Container Apps scales to zero on idle
by default, and the api container is where the scheduler, retention and
extraction workers live. Scaled to zero, it stops receiving HTTP traffic — which
it barely has — and stops ticking, so scheduled sessions and unattended
extraction runs silently stall.

**Run migrations as their own job, before rolling the apps.** The image sets
`RUN_MIGRATIONS_ON_START=false`, so the web app never migrates on boot — a
migration is a discrete step that either succeeds or fails visibly, rather than
something several replicas race to do during a rolling update:

```bash
az containerapp job create \
  --name wayfinder-migrate --resource-group "$RG" --environment wayfinder-env \
  --trigger-type Manual --replica-timeout 600 \
  --image ghcr.io/rbrasier/wayfinder:0.28.17 \
  --command migrate
```

It is safe to re-run — an already-current database is a no-op — and safe to run
concurrently, since instances serialise on an advisory lock. Wait for it to
complete before updating the apps. See [`upgrading.md`](upgrading.md) for the
full upgrade sequence.

**Scaling `api` beyond one replica is safe.** The workers claim work with
`FOR UPDATE SKIP LOCKED`, so concurrent ticks never double-fire.

## 8. Ingress, TLS and Entra sign-in

- Bind your custom domain to the `web` app and let Container Apps issue a managed
  certificate, or front it with Azure Front Door if you want WAF and caching.
  Either way, `BETTER_AUTH_URL` must be the origin users actually reach.
- Chat responses stream over Server-Sent Events. The app sends a keepalive every
  `SSE_HEARTBEAT_MS` (default 25 s), which is inside the Container Apps ingress
  idle timeout. If you front it with Front Door, keep the heartbeat below that
  origin timeout too.
- **Entra ID sign-in** is supported natively. Register an application, add the
  redirect URI `${BETTER_AUTH_URL}/api/auth/callback/microsoft` under the Web
  platform, and either configure it in **Admin → Configuration → Authentication**
  or set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`. A stored
  config always wins over the environment. For a sovereign cloud, override
  `ENTRA_AUTHORITY`.
- **Microsoft 365 email** is supported too: `SMTP_TRANSPORT_MODE=oauth2` with the
  `M365_*` variables sends via Exchange Online over XOAUTH2.

Locked out after an Entra misconfiguration? See
[`recovering-admin-access.md`](recovering-admin-access.md).

## 9. First login

Navigate to your HTTPS origin. On first boot with no admin, the app prints a
`https://your-host/setup?token=…` link to the `web` app's console log — read it
with `az containerapp logs show --name wayfinder-web --resource-group "$RG"` —
then open it, create the administrator, and complete the setup wizard (object
storage, AI provider, sign-in method).

If `ADMIN_SEED_EMAIL` is set, the setup screen pre-fills it and only that address
may create the admin.

## 10. Verify

- Log in as admin
- Navigate to **Admin → Flows** — you should see the empty state
- Upload a test document template via a `generate_document` node
- Check your object store — the file should appear under `templates/`
- Check the `api` app's log for `scheduler heartbeat started`

---

## Alternatives

- **Azure App Service (Linux, Node 20)** avoids containers entirely: two web apps,
  built by Oryx from a GitHub Actions workflow. Workable, but the pnpm workspace
  build needs a custom build command and you lose the single-image guarantee that
  `web` and `api` are the same code.
- **AKS** is the right answer only if you already run AKS. Container Apps gives
  you the same isolation without the cluster.
- **A single Azure VM with Docker Compose** — the repo's
  `docker-compose.prod.yml` brings up web, api, Postgres and MinIO off the same
  published image. The smallest possible footprint for a pilot, at the cost of
  owning patching, backups and TLS.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `extension "vector" is not allow-listed` | Add `VECTOR` to the `azure.extensions` server parameter, then restart the server |
| Container exits immediately with a `SETTINGS_ENCRYPTION_KEY` error | The value must be 64 hex chars or a base64-encoded 32-byte value — `openssl rand -hex 32` |
| `no pg_hba.conf entry … no encryption` | Add `?sslmode=require` to `DATABASE_URL` |
| Sign-in redirects to `localhost:3000` | `BETTER_AUTH_URL` is unset or still the default — it must be the public origin, with no trailing slash |
| Entra sign-in fails on redirect | The app registration is missing `${BETTER_AUTH_URL}/api/auth/callback/microsoft` as a Web redirect URI |
| `Scheduler enabled but not started` in the api log | `SCHEDULER_TICK_SECRET` is unset; set the same value on both apps |
| Scheduled sessions fire only sometimes | The api app is scaling to zero — set its min replicas to 1 |
| Real-time session updates stop arriving | `DATABASE_URL` points at PgBouncer; set `DATABASE_LISTEN_URL` to the direct 5432 endpoint |
| Web app starts but every query fails | Migrations were never run for this version — run the `migrate` command (see [`upgrading.md`](upgrading.md)) |
| `Timed out … waiting for another process to finish migrating` | Another migration is running, or one died holding the lock — check for idle database connections |
| Storage test fails against MinIO | `MINIO_PATH_STYLE` must be `true` for MinIO; `MINIO_REGION` is ignored by it |
