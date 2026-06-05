# Wayfinder

_Last updated: 5 June 2026_

**AI-guided workflow agent for document-heavy processes.**

Wayfinder helps organisations run structured, multi-step workflows where each step involves a
conversational AI gathering information, and one or more steps produce filled-in DOCX documents
(reports, contracts, RFTs, assessments). A flow owner designs the workflow on a canvas; users
follow it via a chat interface; the AI handles all prompting, branching, and document generation.

---

## Features

See [`docs/features.md`](docs/features.md) for full detail on every feature.

### Workflow Design
- **Visual Canvas Builder** — drag-and-drop node editor for designing multi-step workflows; admins configure each step's AI instructions, completion criteria, and output type without writing code.
- **Flow Visibility Control** — flows can be set to private or global, giving admins control over which workflows users can access before they are ready.
- **Step Prompt Preview** — flow owners can preview the exact AI prompt that will be generated for each step before publishing, catching configuration mistakes early.

### Conversational AI Sessions
- **Chat Interface** — users follow published flows via a streaming multi-turn chat powered by LangGraph; the AI gathers information per step and advances automatically when confidence is high enough.
- **Structured AI Turns** — each AI reply includes a scored confidence assessment generated in parallel with the text stream, making step advancement deterministic and auditable.
- **Real-time Collaborative Sessions** — multiple authenticated users can participate in the same session simultaneously via a share link, with typing indicators and near-real-time message propagation.
- **AI Transparency Modals** — users can inspect the AI's reasoning, information sources, and confidence score for any message, presented in plain language.
- **Session Sharing** — owners can share a read-only session link so reviewers and managers can follow a conversation without participating.

### Document Generation
- **DOCX Document Generation** — flow steps automatically fill Word document templates with information gathered during chat, producing finished reports, contracts, and assessments.
- **Template Field Annotations** — `{{ tags }}` support type annotations (`date`, `currency`, `email`, etc.) so the AI formats values correctly before inserting them.
- **Narrative & Optional Sections** — steps can produce free-form narrative text and conditionally include document sections based on conversation outcomes.
- **Context Document Extraction** — PDFs, DOCX, and XLSX files uploaded to a flow are parsed and injected as AI background knowledge for every session on that flow.
- **Template Validation** — templates are validated at upload time; files with invalid tags or annotation syntax are rejected with a clear error message.

### Knowledge Base & RAG
- **RAG with pgvector** — documents are chunked, embedded, and stored in PostgreSQL with pgvector for semantic retrieval during sessions, keeping prompts focused for large corpora.
- **Configurable Embeddings** — embedding model and vector dimensions are environment-variable configurable; a reindex-all command handles model migrations.
- **Session File Upload** — users can upload files mid-session; uploaded files are processed and added to the AI's context immediately.

### Automation & External Integrations
- **n8n Automation Integration** — flow steps can trigger n8n workflows as auto-nodes, posting session context as structured JSON and resuming automatically when n8n responds.
- **n8n Workflow Context Mapping** — outputs returned by n8n are mapped back into the session context so downstream AI steps can reference and build on them.
- **Scheduled Sessions** — flows can start sessions automatically on a cron schedule or interval, running unattended through all auto-nodes.
- **Scheduler Auto-Resume** — interrupted scheduled sessions resume automatically from their last checkpoint when the worker restarts, with no manual intervention required.
- **Plain-Language Schedule UX** — schedules are configured with plain-language recurrence patterns rather than raw cron syntax.

### Analytics & Observability
- **Overview Dashboard** — org-wide metrics including active sessions, completion rates, daily activity trends, and AI confidence over session lifetime.
- **Flow Insights Dashboard** — per-flow step-level drop-off rates, average confidence, node breakdown, and template field value reporting.
- **Langfuse Integration** — optional AI observability tracing for LLM call latency, token counts, and prompt/response inspection.

### Authentication & AI Providers
- **Magic Link Authentication** — passwordless email login; the admin seed email is promoted to admin automatically on first login.
- **Username/Password Authentication** — traditional credential login available alongside magic links for environments that require it.
- **Multi-Provider AI** — Anthropic, OpenAI, Mistral, and AWS Bedrock supported; provider and model are configurable per deployment via environment variables.

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
