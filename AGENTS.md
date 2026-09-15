# AGENTS.md — Routing Index

## Default Behaviour

**Answer general questions directly.** Do not invoke a skill for explanations,
comparisons, architecture questions, or anything that doesn't require writing
new code or documentation.

Invoke a skill only when the user is explicitly planning, reviewing docs,
building, changing, or fixing something. When a skill applies, state:
`Applying skill: /[command] because [one-line reason]`

All skill commands live in `.Codex/commands/`. After any skill that writes
code, run `./validate.sh` and fix all failures before declaring done.

---

## Skill Routing

| If the user is asking to…                                  | Run            |
| ---------------------------------------------------------- | -------------- |
| Plan something new, design a feature, start a project      | `/new-feature` |
| Review docs or validate a phase plan before building       | `/doc-review`  |
| Implement a phase, build a spec, write code                | `/build`       |
| Change or extend existing functionality                    | `/enhance`     |
| Fix something broken or not working                        | `/bugfix`      |
| Cut the next release line, forward-merge fixes             | `/release`     |
| Tag, release & publish a build (container image, later npm) | `/publish`     |
| Anything else                                              | Answer directly |

---

## Project Identity

This repo implements **Wayfinder**, an AI-guided workflow agent for document-heavy
processes. Framework packages live under `@wayfinder/*` in `packages/`. The two
application packages (`apps/web`, `apps/api`) contain all Wayfinder-specific logic.

Run `./validate.sh` once infrastructure (Postgres, Redis, MinIO) is running.

---

## Architecture Rules (non-negotiable)

Enforced by `validate.sh` and ESLint — skills that write code must respect these:

- `packages/domain` has **zero external dependencies**. Pure TypeScript, relative imports only.
- `packages/application` imports only `@wayfinder/domain` and `@wayfinder/shared`. No frameworks, no ORMs, no AI SDKs.
- `packages/adapters` implements interfaces from `packages/domain`. Drizzle, Vercel AI SDK, LangGraph.js, Langfuse, and Better Auth live here.
- Apps (`apps/*`) import from `@wayfinder/application` and `@wayfinder/adapters` only. Wiring lives in `lib/container.ts`.
- All port interfaces use the **Result pattern**: `{ data: T } | { error: DomainError }`. Never throw across boundaries.
- Domain entities are plain TypeScript — no decorators, no ORM annotations.
- DB table names use group prefixes: `core_`, `ai_`, `kb_`, `admin_`, `app_`, `job_`. Columns are snake_case. Every table has `id` (uuid), `created_at`, `updated_at`.
- Schema changes ship as generated migrations only — never `drizzle-kit push`. A migration must carry existing rows across unless the loss is deliberate; one that destroys rows (`DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM`/type change) or that existing rows can make fail (`SET NOT NULL`, `ADD COLUMN … NOT NULL` with no default, `ADD CONSTRAINT … UNIQUE`, `CREATE UNIQUE INDEX`) must declare `-- data-impact: preserved | destructive, approved | blocking, approved — <reason>` in the SQL file. Enforced by `migration-safety.test.ts`; see [`docs/guides/database-conventions.md`](docs/guides/database-conventions.md).

---

## Code Writing Rules (non-negotiable)

These apply whenever any skill writes code:

- **Return early** — reduce nesting; never go more than 2 levels deep in a function
- **Descriptive names** — `userRepository` not `userRepo`, `error` not `err`; no abbreviations
- **No comments explaining WHAT** — only WHY (hidden constraints, workarounds, non-obvious invariants)
- **Result pattern at all boundaries** — never throw across package boundaries
- **Write the test file before the implementation file** — tests are the spec
- **Verify third-party APIs in `node_modules`** — do not rely on training data for exact API shapes; libraries change
- **No dead code** — if something is unused, delete it entirely

---

## Release Branching

Two long-lived branch types. Full contributor-facing rules live in
[`CONTRIBUTING.md`](CONTRIBUTING.md); the complete release model and
maintainer runbook live in
[`docs/guides/managing-releases.md`](docs/guides/managing-releases.md).

- `main` — the **next** release line, in active development. New features land here.
- `release/<line>` — the **current** release line, stabilisation only. Bug fixes
  and enhancements land here; never new features, never a merge from `main`.

**Current release branch: `release/alpha-2`** ← skills read the base branch from
this line; update it when a new line is cut.
**Next release line (on `main`): `alpha-3`** ← skills read the docs folder name
from this line.

| Skill | Base branch (branch from it, open the PR against it) |
|---|---|
| `/new-feature`, `/build` | `main` |
| `/bugfix`, `/enhance` | Current release branch — unless the change only affects unreleased work, then `main` |
| `/release` | Operates on `main` and release branches directly (maintainers only) |

Implemented phase docs go to `docs/development/implemented/<release line>/v<version>/`,
where the release line is read from the two lines above — `alpha-2` when your base
branch is `release/alpha-2`, `alpha-3` when your base branch is `main`. Never derive
it from the version number, and never write into `implemented/` directly.

---

## Versioning

`VERSION` and root `package.json` `version` must always match. `validate.sh` enforces this.

Wayfinder is pre-release, so it follows semver's pre-1.0 rule: **MAJOR stays `0`
until the first stable release**. Every version is `0.MINOR.PATCH`.

- **MAJOR** (`x.0.0`): Reserved. Goes to `1.0.0` only at the first stable release, and means breaking changes after that.
- **MINOR** (`0.x.0`): DB schema change, new phase, new feature
- **PATCH** (`0.0.x`): Bug fixes, UI tweaks, no schema impact

The alpha/beta number is **not** in the version — it lives in the branch name
(`release/alpha-2`) and the docs folder (`implemented/alpha-2/`). Cutting a new
pre-release line creates a branch; it does not bump anything by itself. MINOR
keeps counting up across lines, so versions never restart or go backwards.

Every code-writing skill must state the version bump.
