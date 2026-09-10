# Local Development Setup

Getting a working Wayfinder on your machine, from clone to signed-in.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 20 | [nodejs.org](https://nodejs.org) or `nvm install 20` |
| pnpm | ≥ 9 | `npm install -g pnpm@9` |
| Docker & Docker Compose | any recent | [docker.com](https://www.docker.com/get-started) |
| Git | any recent | pre-installed on most systems |

---

## 1. Clone and install

```bash
git clone https://github.com/rbrasier/wayfinder.git
cd wayfinder
pnpm install
```

`pnpm install` links the four workspace packages (`packages/domain`,
`packages/shared`, `packages/application`, `packages/adapters`) into the two
apps. Nothing is fetched from a package registry for those — they are source in
this repo, resolved through the pnpm workspace.

---

## 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string; default matches docker-compose |
| `BETTER_AUTH_SECRET` | Yes | Any 32-byte random string: `openssl rand -hex 32` |
| `ADMIN_SEED_EMAIL` | Yes | Email that becomes the seeded admin account |
| `AI_DEFAULT_PROVIDER` | Yes | `anthropic` / `openai` / `mistral` |
| `ANTHROPIC_API_KEY` | For AI features | Only if your provider is `anthropic` |
| `OPENAI_API_KEY` | For AI features | Only if your provider is `openai` |
| `MISTRAL_API_KEY` | For AI features | Only if your provider is `mistral` |
| `LANGFUSE_PUBLIC_KEY` | Optional | Omit to disable observability |
| `LANGFUSE_SECRET_KEY` | Optional | Omit to disable observability |

`.env.example` documents every variable, including the optional ones this table
leaves out.

---

## 3. Start infrastructure

```bash
docker compose up -d
```

This starts:

| Service | Default port | Notes |
|---|---|---|
| Postgres 16 + pgvector | 5432 | Required |
| Langfuse 2 | 3030 | Optional — only useful if Langfuse keys are set |

Wait a few seconds for Postgres to become healthy before the next step.

---

## 4. Start the application

```bash
./restart.sh
```

This kills any conflicting processes on ports 3000 / 3001, runs pending
database migrations, checks the schema still matches those migrations, and
starts the Next.js web app and Express API.

| Service | URL |
|---|---|
| Web (Next.js) | http://localhost:3000 |
| API (Express) | http://localhost:3001 |

The admin account is seeded automatically from `ADMIN_SEED_EMAIL`. Use the
magic-link login flow to sign in. In development the link is printed to the
terminal — check the API process output.

Add `--with-mocks` to run against the local mock services in `mocks/` instead
of real external providers.

---

## 5. Before you commit

```bash
./validate.sh
```

Runs the full check suite — typecheck, lint, tests, coverage thresholds, the
architecture boundary rules, and schema/migration consistency. It needs the
infrastructure from step 3 to be running. Everything must pass before a change
ships; see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the branching rules
that go with it.

---

## Customising adapters

Every adapter implements a port interface from `@wayfinder/domain`. You can
override any adapter at four levels — from zero-code config changes up to
replacing the implementation outright. See
[`docs/guides/overriding-adapters.md`](./overriding-adapters.md).

To add a new AI provider, see
[`docs/guides/adding-a-provider.md`](./adding-a-provider.md).

---

## Common issues

| Symptom | Fix |
|---|---|
| Migration fails in `restart.sh` | Ensure `docker compose up -d` ran first and `DATABASE_URL` in `.env` is correct |
| Port 3000 / 3001 already in use | `./restart.sh` handles this automatically; or kill with `lsof -ti:3000 \| xargs kill -9` |
| Admin login email never arrives | In development, the magic link is printed to the API terminal output |
| `./validate.sh` fails with `turbo: not found` | Run `pnpm install` — this installs all CLI tools |
| AI calls fail with 401 | Check that the API key for your chosen `AI_DEFAULT_PROVIDER` is set in `.env` |
| `pnpm install` reports peer dependency warnings | Expected — `eslint-config-next` pins an older TypeScript ESLint parser. Not fatal |
