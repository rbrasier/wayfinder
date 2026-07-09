# Implementation Summary — v0.3.0 Framework Tooling & Publishable Packages

**Version bump:** 0.2.0 → 0.3.0 (MINOR — new capability, no breaking changes)

---

## Phase 1 — Project Init Script

### What was built

A single-command project bootstrap script that replaces the previous manual
find-and-replace process.

### Files created / modified

| Path | Change |
|---|---|
| `scripts/init-project.sh` | New file — interactive scaffold script |
| `package.json` | Added `"init"` script shortcut (`pnpm run init`) |

### How it works

1. Prompts for project name, package scope, AI provider, Langfuse enablement
2. Shows a summary and asks for confirmation before touching any files
3. Runs `grep -rl` + `sed -i` to replace all `@rbrasier/` occurrences in `*.json`, `*.ts`, `*.tsx`, `*.md`, `*.sh`, `*.yml`, `*.yaml`
4. Renames root package name, docker-compose service names, database name, env var defaults
5. Resets git history with a clean initial commit
6. Copies `.env.example` → `.env`
7. Writes `.template-version` (current VERSION file contents)
8. Writes `.framework-scope` (the chosen package scope, e.g. `@rbrasier`)
9. Runs `pnpm install` to regenerate the lockfile
10. Prints next steps

### Known limitations

- `sed -i` differences between GNU (Linux) and BSD (macOS) are handled with platform detection
- Guard clause exits if `@rbrasier/` is no longer present in `packages/domain/package.json` (idempotent)
- Script must be executable in the repo (`chmod +x` committed)

---

## Phase 2 — Publishable Framework Packages

### What was built

Converted the internal monorepo packages into versioned, publishable npm
packages following the "Spark Model". Projects bootstrapped from this template
can now receive ongoing framework updates via `pnpm update`.

### Files created / modified

| Path | Change |
|---|---|
| `packages/domain/package.json` | Removed `private`, added `publishConfig`, updated build to `tsup` |
| `packages/shared/package.json` | Removed `private`, added `publishConfig`, updated build to `tsup` |
| `packages/application/package.json` | Removed `private`, added `publishConfig`, added peerDependencies, updated build to `tsup` |
| `packages/adapters/package.json` | Removed `private`, added `publishConfig`, moved runtime deps to `peerDependencies`, updated build to `tsup` |
| `packages/domain/tsup.config.ts` | New — ESM+CJS+DTS build config |
| `packages/shared/tsup.config.ts` | New — ESM+CJS+DTS build config |
| `packages/application/tsup.config.ts` | New — ESM+CJS+DTS build config with external framework deps |
| `packages/adapters/tsup.config.ts` | New — multi-entry ESM+CJS+DTS build, all peer deps marked external |
| `packages/adapters/src/factory.ts` | New — `createAdapters(db, config)` factory function |
| `packages/adapters/src/index.ts` | Added `export * from "./factory"` |
| `packages/create/package.json` | New package — `@rbrasier/create` scaffold CLI |
| `packages/create/tsconfig.json` | New |
| `packages/create/src/index.ts` | New — interactive CLI using `prompts` + `picocolors` |
| `.changeset/config.json` | New — Changesets configuration |
| `.changeset/README.md` | New — instructions for cutting releases |
| `.github/workflows/ci.yml` | New — typecheck, lint, test, build on PR/push to main |
| `.github/workflows/release.yml` | New — Changesets publish on push to main |
| `validate.sh` | Added checks 11 (publishable packages not private) and 12 (peer dep ranges) |
| `docs/guides/updating-the-framework.md` | New |
| `docs/guides/overriding-adapters.md` | New |
| `docs/guides/publishing-a-release.md` | New |

### Key design decisions

**tsup over tsc for published packages:** tsup produces ESM + CJS dual builds
with declaration files in a single command. The monorepo continues to use
TypeScript source directly (exports point to `src/*.ts`); `publishConfig.exports`
overrides to `dist/` when the package is actually published.

**peerDependencies in adapters:** Framework consumers control which version of
drizzle-orm, better-auth, etc. they install. The adapters package declares
compatibility ranges and ships with all peer deps as devDependencies for the
template's own development.

**`createAdapters` factory:** Single entry point that wires all adapters from a
`Database` connection and `AdaptersConfig`. Supports per-adapter `overrides` for
Level 2 (swap) and Level 3 (extend) customisation patterns. Used by container.ts
in downstream project apps.

**`@rbrasier/create` CLI:** Published as an npx-runnable scaffolder. Clones the
template repo, applies the same find-and-replace as `init-project.sh`, resets
history, writes tracking files, and installs deps. Intended for `npx @rbrasier/create`.

**Changesets linked group:** All four core packages (`domain`, `shared`,
`application`, `adapters`) are in a linked group so they always release at the
same version number — simplifying the consumer update story.

### Known limitations

- `@rbrasier/ui` (React admin component library) is deferred to a future phase.
  Admin pages remain in the scaffold for now.
- The `eject` CLI (`@rbrasier/cli eject <AdapterName>`) is deferred to a future
  phase. Manual ejection instructions are documented in `overriding-adapters.md`.
- Org name is the `@template` placeholder in the template repo. The `init-project.sh`
  script renames it to the user's chosen scope at scaffold time.
