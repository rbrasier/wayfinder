# Wayfinder

**AI-guided workflow agent for document-heavy processes.**

Wayfinder helps organisations run structured, multi-step workflows where each step involves a
conversational AI gathering information, and one or more steps produce filled-in DOCX documents
(reports, contracts, RFTs, assessments). A flow owner designs the workflow on a canvas; users
follow it via a chat interface; the AI handles all prompting, branching, and document generation.

---

## Quickstart (Docker Compose)

```bash
git clone https://github.com/rbrasier/wayfinder
cd wayfinder
cp .env.example .env
# Edit .env: set ADMIN_SEED_EMAIL, ANTHROPIC_API_KEY (or OPENAI_API_KEY / MISTRAL_API_KEY)
docker compose up
```

- Web UI → http://localhost:3000
- MinIO console → http://localhost:9001 (user: `minioadmin`, pass: `minioadmin`)

On first run, request a magic link for the email you set in `ADMIN_SEED_EMAIL`. You are automatically
promoted to admin on login. Navigate to **Admin → Flows** to create your first flow.

---

## Local development (without Docker Compose)

See [`docs/guides/setup-local.md`](docs/guides/setup-local.md).

## Railway deployment

See [`docs/guides/setup-railway.md`](docs/guides/setup-railway.md).

---

## Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 15 (App Router) |
| UI | shadcn/ui + Tailwind CSS |
| Streaming | Vercel AI SDK (`useChat`, `streamObject`) |
| Internal API | tRPC v11 |
| DB | PostgreSQL + pgvector + Drizzle ORM |
| Auth | Better Auth (magic-link, passwordless) |
| AI | Vercel AI SDK — Anthropic / OpenAI / Mistral |
| Agents | LangGraph.js |
| Object storage | MinIO (S3-compatible) |
| Observability | Langfuse (opt-in) + OpenTelemetry |
| Tests | Vitest |

---

## Architecture

Wayfinder follows **hexagonal architecture** (ports and adapters):

```
packages/domain        — pure TypeScript entities + port interfaces. No dependencies.
packages/application   — use cases. Imports domain only.
packages/adapters      — Drizzle, MinIO, LangGraph, Vercel AI SDK, Better Auth.
apps/web               — Next.js app. Imports application + adapters.
apps/api               — Express health/webhook API. Imports application + adapters.
```

Architecture rules are enforced by `validate.sh` and ESLint.

---

## Configuration reference

See [`.env.example`](.env.example) for all variables with inline documentation.

Key variables:

| Variable | Description |
|---|---|
| `ADMIN_SEED_EMAIL` | Email auto-promoted to admin on first login |
| `ANTHROPIC_API_KEY` | Required when `AI_DEFAULT_PROVIDER=anthropic` |
| `DATABASE_URL` | Postgres connection string |
| `MINIO_ENDPOINT` | MinIO / S3 hostname |
| `MINIO_ACCESS_KEY` | MinIO / S3 access key |
| `MINIO_SECRET_KEY` | MinIO / S3 secret key |
| `BETTER_AUTH_SECRET` | 32-byte random string for session signing |

For production on AWS S3, set `MINIO_ENDPOINT=s3.amazonaws.com` and `MINIO_USE_SSL=true`.

---

## Document templates

Example `.docx` templates are in [`docs/templates/`](docs/templates/). Upload them via the
node configuration modal on the canvas (**Admin → Flows → [flow] → edit a generate_document node**).

---

## Licence

[Functional Source Licence 1.1 (FSL-1.1)](LICENSE) — free to use, study, and modify; converts to
Apache 2.0 two years after each release.
