# Implementation Summary — v0.4.0 Framework Update Flow

**Version bump:** 0.3.0 → 0.4.0 (MINOR — new tooling capability, no breaking changes)

---

## Phase 3 — Framework Update Script

### What was built

A single-command guided update script for projects that consume the published
framework packages. Replaces the previous manual `pnpm update` + migration process.

### Files created / modified

| Path | Change |
|---|---|
| `scripts/update-framework.sh` | New file — guided framework update script |
| `scripts/init-project.sh` | Already writes `.framework-scope` (implemented in Phase 1) |
| `package.json` | Added `"framework:update"` script shortcut; bumped version to 0.4.0 |
| `VERSION` | Bumped to 0.4.0 |
| `.gitignore` | Added explicit `!.template-version` and `!.framework-scope` negation rules |

### How it works

1. Reads `FRAMEWORK_SCOPE` from `.framework-scope` (written by `init-project.sh`)
2. Runs `pnpm outdated` for each `${FRAMEWORK_SCOPE}/*` package
3. If nothing is outdated, exits 0 immediately
4. Displays the outdated table and asks for confirmation on MAJOR bumps
5. Runs `pnpm update` for all four framework packages
6. Runs `pnpm run db:migrate` if adapters was updated (skippable via `--skip-migrations`)
7. Runs `./validate.sh` (or just `pnpm typecheck` on MAJOR bumps)
8. Updates `.template-version` to the new framework version
9. Prints a git commit command

### Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Show available updates, make no changes (used in CI) |
| `--interactive` | Confirm every step even on MINOR/PATCH bumps |
| `--skip-migrations` | Skip `db:migrate` (for environments without DB access) |

### CI integration

`.github/workflows/ci.yml` includes a `framework-updates` job that runs
`./scripts/update-framework.sh --dry-run` on every PR. This surfaces available
framework updates informally — it never blocks CI.

### Known limitations

- `pnpm outdated` output format may vary across pnpm versions; the script parses
  it heuristically. Pin pnpm version in `package.json#packageManager` to ensure
  consistent behaviour.
- MAJOR bump detection uses semver major version comparison of `@{scope}/adapters`
  specifically. If only `domain` has a MAJOR bump, detection may be incomplete.
  Full MAJOR detection across all packages is a future improvement.
- `.template-version` update reads the version from the locally installed
  `node_modules` after `pnpm update` — requires node to be available in PATH.
