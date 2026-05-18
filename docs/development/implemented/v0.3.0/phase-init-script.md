# Phase: Project Init Script

- **Status**: Draft
- **Date**: 2026-05-10
- **Target version**: 0.3.0 (bump: PATCH — tooling only, no domain changes)
- **Depends on**: nothing — can ship before the published packages phase

---

## 1. Goal

Give anyone with access to this repo a single command to bootstrap a new
project from the template. Today the process is a manual find-and-replace
across a dozen files. This phase replaces that with:

```bash
./scripts/init-project.sh
```

Run once from the cloned repo root. Asks a few questions, renames everything,
installs dependencies, and prints exactly what to do next.

---

## 2. What the script must do

### 2a. Collect inputs (interactive prompts)

| Prompt | Variable | Validation | Example |
|---|---|---|---|
| Project name | `PROJECT_NAME` | lowercase, hyphens only, no spaces | `my-saas-app` |
| Package scope | `PKG_SCOPE` | defaults to `@{PROJECT_NAME}` | `@my-saas-app` |
| Default AI provider | `AI_PROVIDER` | `anthropic` / `openai` / `mistral` | `anthropic` |
| Enable Langfuse now? | `LANGFUSE_ENABLED` | `y` / `n` | `n` |

All inputs must be re-confirmable before changes are applied. Show a summary
and ask "Proceed? [y/N]" before touching any files.

### 2b. Find-and-replace across the repo

Every substitution must be applied to **all matching files** — not just the
ones listed, in case new files are added to the template later. Use `grep -rl`
to find files containing the pattern, then `sed -i` to apply.

| Find | Replace with | Scope |
|---|---|---|
| `@rbrasier/` | `@{PKG_SCOPE}/` | All `*.json`, `*.ts`, `*.tsx`, `*.md`, `*.sh`, `*.yml`, `*.yaml` |
| `"name": "template"` | `"name": "{PROJECT_NAME}"` | Root `package.json` only |
| `POSTGRES_DB=template` | `POSTGRES_DB={PROJECT_NAME}` | `docker-compose.yml`, `.env.example` |
| `APP_NAME=template` | `APP_NAME={PROJECT_NAME}` | `.env.example` |
| `/template` (in DATABASE_URL) | `/{PROJECT_NAME}` | `.env.example` |
| `template` (service names in docker-compose) | `{PROJECT_NAME}` | `docker-compose.yml` |
| `AI_DEFAULT_PROVIDER=anthropic` | `AI_DEFAULT_PROVIDER={AI_PROVIDER}` | `.env.example` |

#### Langfuse handling

If `LANGFUSE_ENABLED=n`, comment out the Langfuse env vars in `.env.example`
and note in the summary that the tracing adapter is present but will no-op
without keys (this is already the default behaviour).

### 2c. Reset git history

```bash
rm -rf .git
git init
git add .
git commit -m "chore: initial commit from ai-app-template"
```

This gives the new project a clean history with no reference to the template
repo. Do not add a remote — the developer does that themselves.

### 2d. Copy env file

```bash
cp .env.example .env
```

Then print a reminder to fill in secrets before running the app.

### 2e. Install dependencies

```bash
pnpm install
```

This regenerates `pnpm-lock.yaml` with the new package names.

### 2f. Write `.template-version`

```bash
# record the template version this project was scaffolded from
cat VERSION > .template-version
```

Used later by the update script (see the update phase doc) to know what
version the project started from.

### 2g. Print next steps

```
✓ Project "{PROJECT_NAME}" is ready.

Next steps:
  1. Fill in secrets in .env (DATABASE_URL, BETTER_AUTH_SECRET, AI keys)
  2. Start infrastructure:   docker compose up -d
  3. Start the app:          ./restart.sh
  4. Open the app:           http://localhost:3000
  5. Push to GitHub:         git remote add origin <url> && git push -u origin main

Admin login is seeded from ADMIN_SEED_EMAIL in .env.
```

---

## 3. Script location and wiring

- **File**: `scripts/init-project.sh`
- **Permissions**: `chmod +x` committed — script must be executable in the repo
- **Root shortcut**: add `"init": "./scripts/init-project.sh"` to root `package.json` scripts so it can also be run as `pnpm run init`

---

## 4. Implementation notes

- Use only POSIX shell (`#!/usr/bin/env bash`, `set -euo pipefail`) — no Node, no external tools beyond `sed`, `grep`, `git`, `pnpm`
- Guard against running more than once: check if `@rbrasier/` still appears in `packages/domain/package.json`; if not, print "Already initialised — nothing to do" and exit 0
- `sed -i` differs between GNU sed (Linux) and BSD sed (macOS) — use `sed -i.bak` and clean up `.bak` files, or detect the platform
- All `sed` patterns should use `|` as delimiter to avoid clashing with `/` in package scope names

---

## 5. Files created / modified

| Path | Change |
|---|---|
| `scripts/init-project.sh` | New file |
| `package.json` | Add `"init"` script |
| `validate.sh` | Already portable (reads package name dynamically) |
| `restart.sh` | Already portable (reads package name dynamically) |

---

## 6. Out of scope

- Automated GitHub repo creation (developer does this manually)
- Installing a specific npm registry config for published packages (that is the published packages phase)
- Any changes to app code or domain — this is purely a rename + wiring script
