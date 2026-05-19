# Local Development Setup (without Docker Compose)

This guide walks you through running Wayfinder on your local machine without Docker Compose.

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 16 with pgvector extension (local or cloud)
- MinIO — local binary, or a cloud-hosted S3-compatible store (MinIO Cloud, Backblaze B2, AWS S3)
- Redis 7+ (local or cloud)

---

## 1. Clone and install

```bash
git clone https://github.com/rbrasier/wayfinder
cd wayfinder
pnpm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/wayfinder` |
| `REDIS_URL` | `redis://localhost:6379` |
| `BETTER_AUTH_SECRET` | Any 32-byte random string |
| `BETTER_AUTH_URL` | `http://localhost:3000` |
| `ADMIN_SEED_EMAIL` | Your email address |
| `AI_DEFAULT_PROVIDER` | `anthropic` (or `openai`, `mistral`) |
| `ANTHROPIC_API_KEY` | Your API key |
| `MINIO_ENDPOINT` | Hostname of your MinIO / S3 instance |
| `MINIO_PORT` | `9000` for MinIO, `443` for S3 |
| `MINIO_ACCESS_KEY` | Your access key |
| `MINIO_SECRET_KEY` | Your secret key |
| `MINIO_USE_SSL` | `false` for local MinIO, `true` for S3 |

## 3. Create the database

```bash
createdb wayfinder
```

Or create it via your Postgres client. The pgvector extension is created automatically
by the first migration.

## 4. Run migrations

```bash
pnpm db:migrate
```

## 5. Start MinIO locally (if not using a cloud store)

Download MinIO from https://min.io/download and run:

```bash
minio server ./minio-data --console-address :9001
```

The `wayfinder-documents` bucket is created automatically by the app on first start.

## 6. Start the app

```bash
pnpm dev
```

- Web → http://localhost:3000
- API → http://localhost:3001

## 7. First login

Navigate to http://localhost:3000. Request a magic link for the email you set
in `ADMIN_SEED_EMAIL`. Check your terminal — in development the link is printed
to the console instead of sent via email. Click the link to log in.

You are automatically promoted to admin.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is required` | Ensure `.env` exists and `DATABASE_URL` is set |
| `ECONNREFUSED 5432` | Postgres is not running — start it or check the host/port |
| `NoSuchBucket` error | MinIO is running but the bucket does not exist — the app creates it on start; check `MINIO_ENDPOINT`/`MINIO_PORT` |
