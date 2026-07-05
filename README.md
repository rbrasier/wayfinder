# Wayfinder

**AI-guided workflow agent.**

Wayfinder helps organisations run structured, multi-step workflows where each step involves a
conversational AI gathering information, and one or more steps produce filled-in DOCX documents
(reports, contracts, RFTs, assessments). A flow owner designs the workflow on a canvas; users
follow it via a chat interface; the AI handles all prompting, branching, and document generation.

---

## Features

Full detail on every feature — including approvals, knowledge base curation, cost
governance, and accessibility — lives in [`docs/features.md`](docs/features.md).
Highlights:

- **Visual Canvas Builder** — drag-and-drop node editor; admins configure each step's AI instructions, completion criteria, and output type without writing code.
- **Streaming Chat Sessions** — users follow published flows via a multi-turn chat that advances automatically as AI confidence crosses threshold, with full reasoning transparency and real-time collaboration.
- **DOCX Document Generation** — flow steps fill Word templates from the conversation, with typed field annotations, optional sections, and a pre-generation evaluation gate that catches incomplete documents before they're created.
- **Step Approvals** — flows can include a human sign-off gate with federated approver resolution (Entra, HR data, or RAG) and full decision context.
- **Knowledge Base & RAG** — pgvector-backed retrieval over uploaded documents, with an SME curation workflow for correcting and improving what the AI knows.
- **n8n Automation & Scheduling** — flow steps can trigger external workflows or run unattended on a cron schedule.
- **Analytics & Cost Governance** — usage dashboards, per-flow insights, and per-user spend caps with warn-then-block enforcement.
- **Multi-Provider AI** — Anthropic, OpenAI, Mistral, and AWS Bedrock, configurable per deployment.
- **Enterprise Access Control** — Microsoft Entra ID login, custom roles, and WCAG 2.2 AA accessibility.

---

## Why Wayfinder

Wayfinder is a tool designed to created an end-user focused, but strucutred approach to using AI. This is make it simpler to achieve AI powered efficiencies without end users needing to understand prompt engineering

<img width="556" height="532" alt="image" src="https://github.com/user-attachments/assets/481ccfe5-7a61-4995-8e89-65ec4fa08806" />

---

## Quickstart (Docker Compose)

**Current release: alpha-1** (the `1.x.x` line, branch `release/alpha-1`).
Install from the release branch — `main` carries the next alpha in active
development and is not guaranteed stable. See
[`docs/guides/managing-releases.md`](docs/guides/managing-releases.md) for
the release model.

```bash
git clone --branch release/alpha-1 https://github.com/rbrasier/wayfinder
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
| AI | Vercel AI SDK — Anthropic / OpenAI / Mistral / AWS Bedrock |
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

[GNU General Public License v3.0](LICENSE) — free to use, study, modify, and distribute;
any modifications must be released under the same licence.

---

_Last updated: 5 July 2026_
