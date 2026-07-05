# Admin Setup — Template Maintainer

This guide covers setting up a local development environment for **framework
maintainers**: people who work directly on the `ai-app-template` repository,
publish new package versions, and run `./validate.sh`.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| pnpm | ≥ 9 | `npm install -g pnpm@9` |
| Docker & Docker Compose | any recent | [docker.com](https://www.docker.com/get-started) |
| Git | any recent | pre-installed on most systems |

> **Why pnpm?** The monorepo uses pnpm workspaces. `npm` and `yarn` will not
> resolve workspace packages correctly.

---

## 1. Clone the repository

```bash
git clone https://github.com/rbrasier/ai-app-template
cd ai-app-template
```

---

## 2. Install dependencies

```bash
pnpm install
```

This installs all workspace dependencies, including `turbo` (the monorepo task
runner) and `drizzle-kit` (the schema migration CLI). **Both must be installed
before `./validate.sh` will pass** — that is the root cause of the four failing
checks if you skip this step.

---

## 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string; default matches docker-compose |
| `BETTER_AUTH_SECRET` | Yes | Any 32-byte random string: `openssl rand -hex 32` |
| `ADMIN_SEED_EMAIL` | Yes | Email that becomes the seeded admin account |
| `ANTHROPIC_API_KEY` | For AI features | Get from [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | For AI features | Only needed if `AI_DEFAULT_PROVIDER=openai` |
| `MISTRAL_API_KEY` | For AI features | Only needed if `AI_DEFAULT_PROVIDER=mistral` |
| `LANGFUSE_PUBLIC_KEY` | Optional | Omit to disable observability (adapters no-op without it) |
| `LANGFUSE_SECRET_KEY` | Optional | Omit to disable observability |

Leave `DATABASE_URL` and the Langfuse ports as their defaults if
you are using the docker-compose setup below.

---

## 4. Start infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Default port | Notes |
|---|---|---|
| Postgres 16 + pgvector | 5432 | Required |
| Langfuse 2 | 3030 | Optional — skip if Langfuse keys are not set |

Wait a few seconds for Postgres to be healthy before continuing.

---

## 5. Start the development servers

```bash
./restart.sh
```

`restart.sh` will:
1. Kill anything already on ports 3000 and 3001
2. Run `pnpm install` (safe to run again)
3. Run pending database migrations via `drizzle-kit`
4. Start the Next.js web app and the Express API via `turbo dev`

Open [http://localhost:3000](http://localhost:3000). The admin account is
auto-seeded from `ADMIN_SEED_EMAIL` on first start. Use the magic-link flow to
sign in (check your terminal — in development the link is printed to stdout).

---

## 6. Run validation

```bash
./validate.sh
```

All 12 checks must pass (plus informational WARN items for connectivity). If
you see `turbo: not found` or `drizzle-kit: not found`, step 2 was skipped —
run `pnpm install` first.

---

## 7. Making changes and releasing

### Everyday development workflow

Branch from the right base for the kind of change — see
[`CONTRIBUTING.md`](../../CONTRIBUTING.md#2-target-the-right-release):

```bash
# New feature: branch from main
git checkout -b feature/my-feature origin/main

# Bug fix or enhancement: branch from the current alpha branch
git checkout -b fix/my-fix origin/release/alpha-1

# Make changes, then verify
./validate.sh

# Commit and push, then open a PR against the branch you started from
git add <changed-files>
git commit -m "feat: ..."
git push origin feature/my-feature
```

### Cutting a release

Alpha releases follow the two-branch model described in
[`docs/guides/managing-releases.md`](./managing-releases.md): bug fixes and
enhancements stabilise the current `release/alpha-N` branch while new
features build the next alpha on `main`.

Maintainers run the `/release` skill to cut the next alpha, tag an alpha
build, or forward-merge fixes into `main` — it derives the next alpha number
from `main`'s `VERSION` and updates every current-alpha reference.

---

## Common issues

| Symptom | Fix |
|---|---|
| `turbo: not found` | Run `pnpm install` |
| `drizzle-kit: not found` | Run `pnpm install` |
| `validate.sh` check 4 fails (`drizzle schema`) | Run `pnpm install`, then confirm DB is running |
| Migration fails in `restart.sh` | Ensure `docker compose up -d` ran first and `DATABASE_URL` is correct in `.env` |
| Port 3000 / 3001 already in use | `./restart.sh` kills those ports automatically; or kill manually with `lsof -ti:3000 | xargs kill -9` |
| Admin login email never arrives | In development, the magic link is printed to the API terminal output — check there |
