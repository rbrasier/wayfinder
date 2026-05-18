# Updating the Framework

After bootstrapping a project from this template, framework improvements
(new AI providers, improved health checks, bug fixes) flow to your project
via `pnpm update`.

## One-command update

```bash
./scripts/update-framework.sh
```

This script:
1. Checks which `@{scope}/*` packages are outdated
2. Displays changelogs for the version range
3. Prompts confirmation for MAJOR version bumps (breaking changes)
4. Runs `pnpm update` to install the new versions
5. Runs `pnpm run db:migrate` if `@{scope}/adapters` was updated
6. Runs `./validate.sh` to confirm nothing broke
7. Updates `.template-version` to the new framework version
8. Prints a summary and the commit command to use

## Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Show what would update, make no changes (safe for CI) |
| `--interactive` | Confirm every step, even MINOR/PATCH bumps |
| `--skip-migrations` | Skip `db:migrate` (useful when database isn't available) |

## Handling MAJOR version bumps

A MAJOR bump means a port interface or entity type changed. After updating,
your project may have TypeScript errors in:

- `packages/application/` — if use cases depend on a changed port
- `apps/*/src/lib/container.ts` — if adapter constructors changed

The update script runs `pnpm typecheck` on MAJOR bumps and lists files with
errors. Fix them before committing.

## What `.template-version` and `.framework-scope` track

Both files are committed to your repo and should not be gitignored.

| File | Contains | Updated by |
|---|---|---|
| `.template-version` | Semver of the framework version installed | `init-project.sh` and `update-framework.sh` |
| `.framework-scope` | npm scope of the framework (e.g. `@rbrasier`) | `init-project.sh` only |

## Manual update (without the script)

```bash
SCOPE=$(cat .framework-scope)

# Update packages
pnpm update "${SCOPE}/domain" "${SCOPE}/shared" "${SCOPE}/application" "${SCOPE}/adapters"

# Run migrations if adapters changed
pnpm run db:migrate

# Validate
./validate.sh

# Commit
git add package.json pnpm-lock.yaml .template-version
git commit -m "chore: update framework to <version>"
```
