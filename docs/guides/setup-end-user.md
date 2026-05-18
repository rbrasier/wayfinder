# End User Setup — Bootstrapping a New Project

This guide covers creating a **new project** from this template. Follow it once
per project — after the scaffold step the new repo is self-contained and no
longer depends on the template repo directly.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| pnpm | ≥ 9 | `npm install -g pnpm@9` |
| Docker & Docker Compose | any recent | [docker.com](https://www.docker.com/get-started) |
| Git | any recent | pre-installed on most systems |

---

## Option A — One-command scaffold (recommended)

```bash
npx @rbrasier/create
```

The CLI asks a few questions and creates a fully configured project in a new
directory:

1. **Project name** — lowercase letters and hyphens only (e.g. `my-saas-app`)
2. **Package scope** — the npm scope for your packages (e.g. `@my-saas-app`)
3. **Default AI provider** — `anthropic` / `openai` / `mistral`
4. **Langfuse observability** — enable now or stub out (can always be added later)

After confirmation the CLI:
- Clones the template and resets git history
- Renames all `@rbrasier/` references to your scope
- Writes `.template-version` and `.framework-scope` tracking files
- Copies `.env.example` → `.env`
- Runs `pnpm install`

Skip to [Step 2 — Configure environment variables](#2-configure-environment-variables).

---

## Option B — Clone and run init script

If you prefer to clone directly (or need to work offline after cloning):

```bash
git clone https://github.com/rbrasier/ai-app-template my-saas-app
cd my-saas-app
pnpm run init
```

`pnpm run init` calls `scripts/init-project.sh`, which asks the same questions
as the `@rbrasier/create` CLI and performs the same rename and dependency
installation. It exits early if the project was already initialised.

---

## 2. Configure environment variables

The scaffold copies `.env.example` → `.env` automatically. Open `.env` and fill
in the required values:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string; default matches docker-compose |
| `BETTER_AUTH_SECRET` | Yes | Any 32-byte random string: `openssl rand -hex 32` |
| `ADMIN_SEED_EMAIL` | Yes | Email that becomes the seeded admin account |
| `ANTHROPIC_API_KEY` | For AI features | Only if your provider is `anthropic` |
| `OPENAI_API_KEY` | For AI features | Only if your provider is `openai` |
| `MISTRAL_API_KEY` | For AI features | Only if your provider is `mistral` |
| `LANGFUSE_PUBLIC_KEY` | Optional | Omit to disable observability |
| `LANGFUSE_SECRET_KEY` | Optional | Omit to disable observability |

If you chose a non-Anthropic provider during scaffold, `AI_DEFAULT_PROVIDER` is
already updated in `.env` — just add the corresponding API key.

---

## 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Default port | Notes |
|---|---|---|
| Postgres 16 + pgvector | 5432 | Required |
| Redis 7 | 6379 | Required |
| Langfuse 2 | 3030 | Optional — only useful if Langfuse keys are set |

Wait a few seconds for Postgres to become healthy before the next step.

---

## 4. Start the application

```bash
./restart.sh
```

This kills any conflicting processes on ports 3000 / 3001, runs pending
database migrations, and starts the Next.js web app and Express API.

| Service | URL |
|---|---|
| Web (Next.js) | http://localhost:3000 |
| API (Express) | http://localhost:3001 |

The admin account is seeded automatically from `ADMIN_SEED_EMAIL`. Use the
magic-link login flow to sign in. In development the link is printed to the
terminal — check the API process output.

---

## 5. Push to GitHub

```bash
git remote add origin https://github.com/<your-org>/<your-repo>.git
git push -u origin main
```

---

## Receiving framework updates

When the template ships improvements, pull them into your project:

```bash
./scripts/update-framework.sh
```

This checks for new versions of your `@{scope}/*` packages, prompts
confirmation on MAJOR version bumps, runs migrations, and validates. See
[`docs/guides/updating-the-framework.md`](./updating-the-framework.md) for
details and flags.

---

## Customising adapters

Every framework adapter implements a port interface from `@{scope}/domain`.
You can override any adapter at four levels — from zero-code config changes up
to full ejection — without losing framework update compatibility. See
[`docs/guides/overriding-adapters.md`](./overriding-adapters.md).

---

## Common issues

| Symptom | Fix |
|---|---|
| `pnpm run init` says "Already initialised" | The scaffold already ran — nothing to do |
| Migration fails in `restart.sh` | Ensure `docker compose up -d` ran first and `DATABASE_URL` in `.env` is correct |
| Port 3000 / 3001 already in use | `./restart.sh` handles this automatically; or kill with `lsof -ti:3000 | xargs kill -9` |
| Admin login email never arrives | In development, the magic link is printed to the API terminal output |
| `./validate.sh` fails with `turbo: not found` | Run `pnpm install` — this installs all CLI tools |
| AI calls fail with 401 | Check that the API key for your chosen `AI_DEFAULT_PROVIDER` is set in `.env` |
