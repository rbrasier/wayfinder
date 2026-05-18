# ADR-003 — Monorepo Structure with pnpm + Turborepo

- **Status**: Accepted
- **Date**: 2026-05-07

## Context

The template ships two deployable apps (`apps/web`, `apps/api`) and four
shared packages (`domain`, `application`, `shared`, `adapters`). Cross-package
type-safety must hold without publishing internal packages to npm.

## Decision

- **pnpm workspaces** for package management. Strict dependency isolation,
  fast installs, content-addressable store.
- **Turborepo** for task orchestration. Pipelines defined in `turbo.json`
  with `dependsOn: ["^build"]` so Turbo builds packages in the right order
  and caches outputs.

### Package layout

```
apps/
  web/        @rbrasier/web — Next.js 15, tRPC v11
  api/        @rbrasier/api — Express, Zod
packages/
  domain/         @rbrasier/domain
  application/    @rbrasier/application
  shared/         @rbrasier/shared
  adapters/       @rbrasier/adapters
```

### Why `@rbrasier/*` as the scope?

`template` is the placeholder project name. The "New App / Feature Setup"
skill in `CLAUDE.md` walks the new owner through renaming the scope to their
real project name on bootstrap.

### TypeScript project references

Each package has `composite: true` and `references` to its dependencies.
This makes IDE go-to-definition jump straight to the source file rather than
a built `.d.ts`, and lets `tsc -b` build the graph in dependency order.

## Consequences

**Positive**

- One `pnpm install` at the root resolves the whole graph.
- `pnpm --filter @rbrasier/<x>` runs scripts per package.
- Turbo caches make the typical `pnpm typecheck` near-instant after the first
  run.

**Negative**

- The first install is slower than a single-package repo.
- Tooling (some IDE plugins, some test runners) needs monorepo-aware
  configuration.

## Alternatives considered

- **Nx**: more powerful, but heavier. Turborepo's `turbo.json` is ~20 lines
  for what we need.
- **Single package with subdirectories**: would not enforce the architectural
  boundary at the import level. Rejected.
