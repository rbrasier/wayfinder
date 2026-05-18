# ai-app-template

Production-ready AI application monorepo template using **hexagonal architecture**.

---

## Create a new project

```bash
mkdir my-app && cd my-app
pnpm create ai-app-template
./restart.sh
# web → http://localhost:3000   api → http://localhost:3001
```

The create script prompts for project name, package scope, AI provider, database
setup (name or existing URL), and admin email. It detects PostgreSQL locally, offers
to install it or use Docker Compose if not found, auto-generates `BETTER_AUTH_SECRET`,
and writes a fully-populated `.env`. Then `./restart.sh` installs all packages, starts
infrastructure, runs migrations, and launches the dev servers.

To pull in framework updates later:

```bash
pnpm run framework:update
```

---

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend**: Next.js 15 (App Router) — `/app/(user)/*` and `/app/(admin)/*`
- **UI**: shadcn/ui + Tailwind CSS
- **Streaming**: Vercel AI SDK (`useChat`, `streamObject`)
- **Internal API**: tRPC v11 via Next.js Route Handlers
- **Public API**: Express with Zod-validated routes
- **DB**: PostgreSQL + Drizzle ORM + pgvector
- **Auth**: Better Auth (magic-link, passwordless)
- **AI**: Vercel AI SDK with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/mistral`
- **Agents**: LangGraph.js (lives entirely in `packages/adapters`)
- **Observability**: Langfuse (stubbed by default — activates when env vars are set)
- **Errors**: Custom in-DB error log via `IErrorLogger` port
- **Tests**: Vitest
- **Runtime**: Node 20+, always-on (Railway / Fly.io)

---

## Contributing to this template

If you are working on the template itself (not creating a project from it):

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, BETTER_AUTH_SECRET, etc.
docker compose up -d
pnpm db:migrate
./restart.sh
# web → http://localhost:3000   api → http://localhost:3001
```

---

## Repo Layout

```
apps/
  web/                 Next.js — user + admin UI, tRPC routes
  api/                 Express — public REST API
packages/
  domain/              Pure TypeScript. Entities, ports, errors.
                       ZERO external dependencies.
  application/         Use cases. Imports only @rbrasier/domain.
  adapters/            Drizzle, AI SDK, LangGraph, Langfuse, Better Auth.
                       Implements port interfaces.
  shared/              Zod schemas, types, utils. No business logic.
docs/
  guides/              Architecture, conventions, how-tos
  development/
    to-be-implemented/ PRDs, ADRs, phase docs awaiting implementation
    implemented/       Completed work organised by version (v0.1/, v0.2/…)
    adr/               Permanent home for ADRs
    prd/               Permanent home for PRDs
CLAUDE.md              Skill routing rules — read this first
VERSION                Plain text version (e.g. 0.1.0)
validate.sh            Runs typecheck + lint + tests + arch checks
restart.sh             Kills ports, runs migrations, starts dev servers
```

---

## The Skill System

This template ships with a **skill routing layer** in `CLAUDE.md`. Every prompt
to Claude Code is routed automatically:

| If you say…                                | Skill                       |
| ------------------------------------------ | --------------------------- |
| "let's plan…", "design a…"                 | New App / Feature Setup     |
| "review the docs", "let's build this"      | Documentation Review        |
| "implement phase X"                        | Build — New Phase / Feature |
| "change…", "extend…"                       | Enhancement / Revision      |
| "broken", "not working"                    | Bug Fix                     |

Each skill follows a documented workflow that produces docs in
`docs/development/`, then code, then runs `./validate.sh`.

See `docs/guides/skills.md` for full detail.

---

## Working Pages

- **`/`** — Landing hero
- **`/sample`** — AI demo: streaming structured response (text + confidence + rationale)
- **`/admin`** — Admin dashboard (auth required, magic-link)
- **`/admin/users`** — User CRUD
- **`/admin/errors`** — Grouped error log with status updates

---

## Versioning

`MAJOR.MINOR.PATCH` tracked in both `VERSION` and root `package.json` (must match).

- MAJOR — breaking API / domain changes
- MINOR — DB schema change, new phase, new feature
- PATCH — bug fixes, UI tweaks, config changes with no schema impact

Starting version: `0.1.0`.

---

## Validation

```bash
./validate.sh
```

Runs typecheck, lint, tests, Drizzle schema check, domain-purity grep,
table-naming check, version sync, and doc lifecycle checks. Must pass
before any commit lands.
