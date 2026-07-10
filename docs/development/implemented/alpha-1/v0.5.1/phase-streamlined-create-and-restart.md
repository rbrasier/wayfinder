# Phase: Streamlined Create & Restart Flow

**Version bump:** PATCH — 0.5.0 → 0.5.1
**Status:** implemented

---

## Why

The current setup requires 5+ manual steps after scaffolding (fill .env, start docker,
migrate, restart). The target UX is three steps: `cd my-app` → `pnpm create ai-app-template`
→ `./restart.sh`. The create script must handle DB configuration, secret generation, and
write a fully-populated `.env` so the user never touches it manually.

---

## Changes

### 1. `packages/create/src/index.ts`

- **Scaffold into `process.cwd()`** instead of creating a subdirectory. Project name defaults
  to the current directory's basename. Clone with `git clone --depth=1 REPO .`.
- **DB setup prompts:**
  - Ask: "Database name or connection URL?" (no `://` → treat as DB name; otherwise use as-is).
  - If DB name: detect postgres via `pg_isready` / `psql --version`. If not found, offer:
    (a) Install via brew (macOS) or apt (Linux), (b) Use Docker Compose.
  - Build `DATABASE_URL` from the name (e.g. `postgresql://postgres:postgres@localhost:5432/{name}`)
    or pass through the supplied URL.
- **Auto-generate `BETTER_AUTH_SECRET`:** `crypto.randomBytes(32).toString("base64url")`.
- **Ask for ADMIN_SEED_EMAIL** (default `admin@example.com`).
- **Ask for AI provider key** for the selected provider.
- **Write `.env`** with real values substituted (not just copy from `.env.example`).
- Update next-steps output to only say `./restart.sh`.

### 2. `restart.sh`

- If `docker-compose.yml` exists in the project root, run `docker compose up -d` and wait
  for postgres to accept connections (poll `pg_isready` or TCP for up to 30 s) before
  attempting migrations.
- Existing behaviour retained: `pnpm install`, `db:migrate`, `pnpm turbo dev`.

### 3. `README.md`

Update "Create a new project" section to show the 3-step flow:

```
cd my-app
pnpm create ai-app-template
./restart.sh
```

Remove the manual `.env`, `docker compose`, and `pnpm db:migrate` steps from the
post-scaffold instructions.

---

## Non-goals

- No changes to domain, application, adapters, or apps packages.
- No new DB schema.
- No new npm dependencies (use Node built-ins: `crypto`, `child_process`).

---

## Tests

The create script is an interactive CLI with no existing test coverage. Because the logic
is pure string/file manipulation wrapped in prompts, tests will cover the helper functions
(DB URL detection, secret generation, file writing helpers) via mocked FS — not the
interactive prompt flow (which requires a real terminal).
