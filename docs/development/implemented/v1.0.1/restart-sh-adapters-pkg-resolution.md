# Bug: restart.sh fails in scaffolded project — missing packages/adapters/package.json

## Root Cause

`restart.sh` line 85 unconditionally reads `./packages/adapters/package.json` to
resolve the `pnpm --filter` target for running migrations:

```bash
ADAPTERS_PKG=$(node -e "process.stdout.write(require('./packages/adapters/package.json').name)")
```

The create CLI (`packages/create/src/index.ts`) removes the entire `packages/`
directory during scaffolding — it becomes a versioned npm dependency, not local
workspace code. The scaffolded project has no `packages/` directory, so Node
throws `MODULE_NOT_FOUND` and `restart.sh` exits immediately after `pnpm install`.

The create CLI does write a `.framework-scope` file (value: `@rbrasier`) to the
scaffolded project root, which provides the information needed to reconstruct the
package name without reading the local source tree.

## Reproduction

```bash
./init-project-test.sh --keep
cd /tmp/create-ai-app-template-XXXXXX/project
./restart.sh
# → Error: Cannot find module './packages/adapters/package.json'
```

## Fix Plan

In `restart.sh`, replace the unconditional `require('./packages/adapters/package.json')`
call with a conditional that checks for the local file first and falls back to
`.framework-scope` when running in a scaffolded project:

```bash
if [ -f packages/adapters/package.json ]; then
  ADAPTERS_PKG=$(node -e "process.stdout.write(require('./packages/adapters/package.json').name)")
else
  FRAMEWORK_SCOPE=$(cat .framework-scope 2>/dev/null || echo "@rbrasier")
  ADAPTERS_PKG="${FRAMEWORK_SCOPE}/adapters"
fi
```

## Version Bump

PATCH: `1.0.0 → 1.0.1`

## Implementation Summary

**Root cause**: `restart.sh` read `./packages/adapters/package.json` unconditionally.
In a scaffolded project that file does not exist, causing `MODULE_NOT_FOUND` and an
immediate exit after `pnpm install`.

**Fix applied** (`restart.sh`): replaced the single `node -e require(...)` call with
an `if [ -f packages/adapters/package.json ]` guard. The else branch reads the
framework scope from `.framework-scope` (written by `create-ai-app-template` during
scaffold) and constructs the package name as `${FRAMEWORK_SCOPE}/adapters`.

**Regression test added** (`validate.sh` section 16): asserts that `restart.sh`
contains the `if [ -f packages/adapters/package.json ]` guard. Fails if the guard
is ever removed.
