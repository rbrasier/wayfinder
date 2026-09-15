# Wayfinder

**AI-guided workflow agent.**

Wayfinder helps organisations run structured, multi-step workflows where each step involves a
conversational AI gathering information, and one or more steps produce filled-in DOCX documents
(reports, contracts, RFTs, assessments). A flow owner designs the workflow on a canvas; users
follow it via a chat interface; the AI handles all prompting, branching, and document generation.

---


https://github.com/user-attachments/assets/ca76d73d-c064-4711-ad75-48fd14eafaf2


---

## Features

Full detail on every feature — including approvals, knowledge base curation, cost
governance, and accessibility — lives in [`docs/features.md`](docs/features.md).
Highlights:

- **Guided, Governed Sessions** — users are walked through the process one step at a time in a chat that only advances when the AI's confidence clears the threshold the flow owner set, so the process is followed rather than improvised.
- **Finished Documents, Not Transcripts** — steps fill Word templates from the conversation, with typed field annotations, optional sections, and a pre-generation gate that holds the step until the document would actually be complete.
- **Authored by the Process Owner, Not a Developer** — the person who owns the process builds it on a drag-and-drop canvas: instructions, completion criteria, branching, and output per step, with no code and no prompt engineering.
- **Human Sign-Off Where It Matters** — approval nodes pause a session for a named approver — resolved from Entra, HR data, or the flow's own reference material — who sees the actual output before deciding.
- **Grounded in Your Own Material** — pgvector retrieval over uploaded documents, with an SME curation loop for correcting and improving what the AI knows when it gets something wrong.
- **Nothing the AI Does Is Opaque** — every turn exposes its reasoning, sources, and confidence score, and every decision, edit, and approval lands in a durable audit trail.
- **Steps That Need No Human** — a step can hand off to an n8n workflow, and a whole flow can run unattended on a plain-language schedule.
- **Spend and Usage Under Control** — per-user daily, weekly, or monthly caps with warn-then-block enforcement, alongside dashboards showing where users drop off and what documents actually contain.
- **Fits the Organisation** — Microsoft Entra ID sign-in, custom roles, WCAG 2.2 AA accessibility, and a choice of Anthropic, OpenAI, Mistral, or AWS Bedrock per deployment.

---

## Why Wayfinder

Wayfinder is a tool designed to created an end-user focused, but strucutred approach to using AI. This is make it simpler to achieve AI powered efficiencies without end users needing to understand prompt engineering

<img width="556" height="532" alt="image" src="https://github.com/user-attachments/assets/481ccfe5-7a61-4995-8e89-65ec4fa08806" />

---

## Quickstart (Docker Compose)

**Current release: alpha-2** (branch `release/alpha-2`, versions `0.19.x`).
Install from the release branch — `main` carries the next line (alpha-3) in
active development and is not guaranteed stable. See
[`docs/guides/managing-releases.md`](docs/guides/managing-releases.md) for
the release model.

**Zero-env quick-start — no `.env` editing required.**

```bash
git clone --branch release/alpha-2 https://github.com/rbrasier/wayfinder
cd wayfinder
docker compose up -d      # Postgres + MinIO (skip if you bring your own)
./restart.sh              # generates secrets, migrates, starts the app
# → open the printed  http://localhost:3000/setup?token=…  link
# → set the admin email + password, then complete the setup wizard
```

`restart.sh` seeds `.env` from `.env.example` and auto-generates the three
secrets it needs (`SETTINGS_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and
`SCHEDULER_TICK_SECRET`, without which scheduled sessions never fire);
`DATABASE_URL` ships a working default. On first boot with no admin, the app
prints a clickable `/setup?token=…` link to the server log.

Prefer to write the file yourself? Copy the minimal development sample instead —
it is four values, three of which are `openssl rand -hex 32`:

```bash
cp .env.min.example.dev .env
# fill in the three secrets, then:
./restart.sh
```

Everything omitted from that file has a working default. For a deployment, use
[`.env.min.example.prod`](.env.min.example.prod), which adds the vars whose
defaults point at localhost. [`.env.example`](.env.example) is the full,
annotated set of overrides.

- Web UI → http://localhost:3000
- MinIO console → http://localhost:9001 (user: `minioadmin`, pass: `minioadmin`)

On first run, open the printed setup link, create the administrator account, and
the **setup wizard** walks you through object storage, an AI provider, a sign-in
method, and optional integrations — each configured in-app and testable in place.
No integration needs to be set in `.env`; env-based configuration is an optional
override.

---

## Local development (without Docker Compose)

See [`docs/guides/setup-local.md`](docs/guides/setup-local.md).

## Deployment

Wayfinder ships as a public container image — `ghcr.io/rbrasier/wayfinder` — so
no deployment target needs a build toolchain.

The whole stack on one host:

```bash
cp .env.min.example.prod .env    # then fill in the secrets it names
docker compose -f docker-compose.prod.yml up -d
```

That brings up web, api, Postgres and object storage, runs migrations as their
own step, and leaves you at the first-run `/setup` page. Object storage, the AI
provider, mail and sign-in are all configured there — not in environment
variables.

| Target | Guide |
|---|---|
| Docker Compose (single host) | `docker-compose.prod.yml` |
| Railway | [`docs/guides/setup-railway.md`](docs/guides/setup-railway.md) |
| AWS (ECS Fargate + RDS + S3) | [`docs/guides/setup-aws.md`](docs/guides/setup-aws.md) |
| Azure (Container Apps + Flexible Server) | [`docs/guides/setup-azure.md`](docs/guides/setup-azure.md) |
| Upgrading an existing deployment | [`docs/guides/upgrading.md`](docs/guides/upgrading.md) |

## Locked out of admin

If a Microsoft Entra ID failure has left nobody able to sign in as an
administrator, see
[`docs/guides/recovering-admin-access.md`](docs/guides/recovering-admin-access.md).

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
