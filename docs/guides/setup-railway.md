# Railway Deployment

This guide deploys Wayfinder to [Railway](https://railway.app).

## 1. Create a new Railway project

1. Go to https://railway.app/new
2. Select **Deploy from GitHub repo** and connect your fork of `wayfinder`
3. Railway detects the monorepo. You will need two services: `web` and `api`.

Alternatively, use the Railway CLI:

```bash
railway login
railway init
```

## 2. Add required services

In your Railway project, add:

- **PostgreSQL** plugin (provides `DATABASE_URL` automatically)
- **Redis** plugin (provides `REDIS_URL` automatically)
- **MinIO plugin** — or point at an external S3-compatible store (Backblaze B2, AWS S3, etc.)

## 3. Environment variable mapping

Set the following variables on both the `web` and `api` services:

| Wayfinder variable | Source |
|---|---|
| `DATABASE_URL` | Injected by Railway Postgres plugin |
| `REDIS_URL` | Injected by Railway Redis plugin |
| `BETTER_AUTH_SECRET` | Generate: `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Your Railway-assigned URL, e.g. `https://wayfinder-web.up.railway.app` |
| `ADMIN_SEED_EMAIL` | Your admin email |
| `AI_DEFAULT_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | Your key |
| `MINIO_ENDPOINT` | MinIO plugin hostname or your S3 endpoint |
| `MINIO_PORT` | `443` for HTTPS, `9000` for plain HTTP |
| `MINIO_ACCESS_KEY` | MinIO / S3 access key |
| `MINIO_SECRET_KEY` | MinIO / S3 secret key |
| `MINIO_BUCKET` | `wayfinder-documents` |
| `MINIO_USE_SSL` | `true` (Railway uses HTTPS) |

**Set `ADMIN_SEED_EMAIL` before the first deploy** — the seed runs on startup.

## 4. Deploy

Push to `main` (or trigger a manual deploy). Railway builds and deploys both services.

## 5. First login

Navigate to your Railway-assigned URL. Request a magic link for the email in
`ADMIN_SEED_EMAIL`. Check the Railway log for your `web` service — in development
mode the link is printed there. In production, configure a real email provider
(SMTP or Resend) via the Better Auth configuration.

## 6. Verify

- Log in as admin
- Navigate to **Admin → Flows** — you should see the empty state
- Upload a test document template via a `generate_document` node
- Check the MinIO / S3 bucket — the file should appear under `templates/`
