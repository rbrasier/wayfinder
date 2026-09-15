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
  web/        @wayfinder/web — Next.js 15, tRPC v11
  api/        @wayfinder/api — Express, Zod
packages/
  domain/         @wayfinder/domain
  application/    @wayfinder/application
  shared/         @wayfinder/shared
  adapters/       @wayfinder/adapters
```

### Why `@wayfinder/*` as the scope?

One scope for the whole repo, named after the product. The packages are
workspace-only and never published, so the scope exists to group them and to
make an import's layer obvious at a glance, not to reserve a registry name.

**Amended v0.35.1.** This ADR originally specified the personal-handle scope
inherited from the `ai-app-template` repository Wayfinder was cloned from, and
said the bootstrap script would rename it to the real project name. That rename
ran for `apps/*` and never ran for `packages/*`, leaving the two halves of the
repo under different scopes for several release lines. v0.35.1 finished it and
removed the template scaffolding that was supposed to have done it. Phase docs
under `docs/development/implemented/` still show the old scope; they record what
was true at the time and were deliberately left alone.

### TypeScript project references

Each package has `composite: true` and `references` to its dependencies.
This makes IDE go-to-definition jump straight to the source file rather than
a built `.d.ts`, and lets `tsc -b` build the graph in dependency order.

## Consequences

**Positive**

- One `pnpm install` at the root resolves the whole graph.
- `pnpm --filter @wayfinder/<x>` runs scripts per package.
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
