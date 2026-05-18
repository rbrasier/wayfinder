# Phase: Framework Update Flow

- **Status**: Draft
- **Date**: 2026-05-10
- **Target version**: 0.4.0 (bump: MINOR — new tooling capability)
- **Depends on**: phase-publishable-framework-packages.md must be complete first

---

## 1. Goal

Give developers using a project built from this template a single command to
pull in framework improvements:

```bash
./scripts/update-framework.sh
```

This covers everything from fetching the latest package versions, running any
new database migrations, and validating the result — so an update is safe and
auditable in one step.

---

## 2. What "updating" means at each phase

### Before published packages (current state)

There is no update path. The project is a fork of the template and drifts
independently. Developers who want template improvements must cherry-pick
commits manually. The init script records the starting version in
`.template-version` as a reference point, but nothing automates the merge.

### After published packages (this phase)

Framework code lives in versioned npm packages (`@your-org/core`,
`@your-org/adapters`, etc.). Updating means bumping those packages via the
normal package manager, then handling any side effects (migrations, breaking
changes).

The update script makes this a guided, one-command operation.

---

## 3. What the update script must do

### 3a. Check for available updates

```bash
pnpm outdated --filter "@your-org/*"
```

If nothing is outdated, print "Already on the latest framework version" and
exit 0.

Otherwise show a table:

```
Package                  Current   Latest   Change
@your-org/core           0.3.0     0.4.0    MINOR
@your-org/adapters       0.3.0     0.4.0    MINOR
@your-org/application    0.3.0     0.4.0    MINOR
@your-org/shared         0.3.0     0.4.0    MINOR
```

### 3b. Show the changelog

Fetch and print the `CHANGELOG.md` sections for each package covering the
range between the installed version and the latest. If the change includes a
MAJOR bump, print a prominent warning and require explicit confirmation before
proceeding.

```
⚠  MAJOR version bump detected in @your-org/adapters.
   Review the breaking changes above before continuing.
   Proceed? [y/N]
```

For MINOR and PATCH bumps, proceed automatically unless `--interactive` flag
is passed.

### 3c. Update packages

```bash
pnpm update "@your-org/core" "@your-org/adapters" "@your-org/application" "@your-org/shared"
```

Uses the version ranges already in `package.json`. To pin to an exact version,
the developer edits `package.json` manually — the script does not override
their version pinning strategy.

### 3d. Run database migrations

If `@your-org/adapters` was updated, new tables or columns may have been added.

```bash
pnpm run db:migrate
```

The script detects whether adapters changed by comparing the before/after
version. If migrations fail (e.g. DATABASE_URL not set), print the error and
exit non-zero — do not silently continue.

### 3e. Run validate.sh

```bash
./validate.sh
```

If validation fails, print:

```
✗ Validation failed after update. The update has been applied but something
  needs attention. Fix the failures above, then commit.
```

Do not roll back the update — that would be destructive. The developer fixes
forward.

### 3f. Update `.template-version`

```bash
# record the framework version this project is now on
node -e "process.stdout.write(require('./node_modules/@your-org/core/package.json').version)" \
  > .template-version
```

### 3g. Print summary

```
✓ Framework updated to 0.4.0.

  Packages updated:   4
  Migrations run:     2 new tables
  Validation:         PASS

  Review the changes:
    git diff
  Then commit:
    git add package.json pnpm-lock.yaml .template-version
    git commit -m "chore: update framework to 0.4.0"
```

---

## 4. Handling breaking changes (MAJOR bumps)

A MAJOR bump means a port interface changed or an entity field was removed.
The developer's application code may need updating before it compiles.

The script handles this by:

1. Printing the breaking change notes from the changelog
2. Requiring explicit confirmation
3. Running `pnpm typecheck` after the update instead of the full `validate.sh`
4. Reporting which files have type errors so the developer knows what to fix

This is intentional — the script cannot automatically fix application code
that depends on a changed interface. Type errors are the signal.

---

## 5. Script location and wiring

- **File**: `scripts/update-framework.sh`
- **Permissions**: `chmod +x` committed
- **Root shortcut**: add `"framework:update": "./scripts/update-framework.sh"` to root `package.json` scripts
- **Flags**:
  - `--dry-run` — show what would change, make no modifications
  - `--interactive` — confirm every step, even MINOR bumps
  - `--skip-migrations` — update packages only, skip `db:migrate` (for CI environments)

---

## 6. Package name resolution

The script must not hardcode `@your-org`. It resolves the framework scope from
a config file written by the init script:

**`.framework-scope`** (written by `init-project.sh`):
```
@your-org
```

The update script reads this:
```bash
FRAMEWORK_SCOPE=$(cat .framework-scope 2>/dev/null || echo "@your-org")
```

---

## 7. `.template-version` vs. `.framework-scope`

| File | Written by | Contains | Used by |
|---|---|---|---|
| `.template-version` | `init-project.sh` on scaffold; `update-framework.sh` after each update | Semver string of the framework version currently installed | `update-framework.sh` to show the delta |
| `.framework-scope` | `init-project.sh` on scaffold | The npm scope of the framework packages (e.g. `@rbrasier`) | `update-framework.sh` to know which packages to update |

Both files should be committed to the project repo so every team member and
CI environment uses the same reference.

---

## 8. CI integration

Add a step to CI that runs `./scripts/update-framework.sh --dry-run` and
posts a PR comment if updates are available. This surfaces framework updates
without requiring developers to manually check.

Example GitHub Actions step:

```yaml
- name: Check for framework updates
  run: ./scripts/update-framework.sh --dry-run
  continue-on-error: true   # informational only, does not block CI
```

---

## 9. Files created / modified

| Path | Change |
|---|---|
| `scripts/update-framework.sh` | New file |
| `scripts/init-project.sh` | Updated to write `.framework-scope` in addition to `.template-version` |
| `package.json` | Add `"framework:update"` script |
| `.gitignore` | Ensure `.template-version` and `.framework-scope` are NOT ignored (they must be committed) |

---

## 10. Out of scope

- Automatic PR creation for framework updates (could be a follow-on GitHub Action)
- Rolling back an update (fix-forward is the intended pattern)
- Updating the scaffold template itself — this script updates apps that consume
  the published packages, not the template repo that publishes them
