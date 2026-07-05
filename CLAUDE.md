# CLAUDE.md — Routing Index

## Default Behaviour

**Answer general questions directly.** Do not invoke a skill for explanations,
comparisons, architecture questions, or anything that doesn't require writing
new code or documentation.

Invoke a skill only when the user is explicitly planning, reviewing docs,
building, changing, or fixing something. When a skill applies, state:
`Applying skill: /[command] because [one-line reason]`

All skill commands live in `.claude/commands/`. After any skill that writes
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
| Anything else                                              | Answer directly |

---

## Project Identity

This repo implements **Wayfinder**, an AI-guided workflow agent for document-heavy
processes. Framework packages live under `@rbrasier/*` in `packages/`. The two
application packages (`apps/web`, `apps/api`) contain all Wayfinder-specific logic.

Run `./validate.sh` once infrastructure (Postgres, Redis, MinIO) is running.

---

## Architecture Rules (non-negotiable)

Enforced by `validate.sh` and ESLint — skills that write code must respect these:

- `packages/domain` has **zero external dependencies**. Pure TypeScript, relative imports only.
- `packages/application` imports only `@rbrasier/domain` and `@rbrasier/shared`. No frameworks, no ORMs, no AI SDKs.
- `packages/adapters` implements interfaces from `packages/domain`. Drizzle, Vercel AI SDK, LangGraph.js, Langfuse, and Better Auth live here.
- Apps (`apps/*`) import from `@rbrasier/application` and `@rbrasier/adapters` only. Wiring lives in `lib/container.ts`.
- All port interfaces use the **Result pattern**: `{ data: T } | { error: DomainError }`. Never throw across boundaries.
- Domain entities are plain TypeScript — no decorators, no ORM annotations.
- DB table names use group prefixes: `core_`, `ai_`, `kb_`, `admin_`, `app_`, `job_`. Columns are snake_case. Every table has `id` (uuid), `created_at`, `updated_at`.

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

## Wayfinder — Product Positioning

Wayfinder occupies a distinct position in the AI tooling landscape: **structured workflow + end user**. No current tool sits in this quadrant.

| Tool | User Axis | Structure Axis |
|---|---|---|
| Wayfinder | End User | Structured |
| Cowork | End User (slight) | Structured (slight) |
| Dify | Developer | Structured |
| n8n | Developer | Mid |
| ChatGPT | End User | Open Ended |
| Claude Code | Developer | Open Ended |

### Axis Definitions

- **Structured ↔ Open Ended**: Does the tool guide users through a defined process, or does it respond freely to whatever the user asks?
- **End User ↔ Developer**: Is the primary operator a business user (no-code), or a developer building/configuring the tool?

### Quadrant Summary

| Quadrant | Description | Examples |
|---|---|---|
| Structured + End User | Governed, guided workflows for non-technical operators | **Wayfinder**, Cowork |
| Structured + Developer | Visual builders and frameworks for devs wiring AI pipelines | Dify, n8n, LangChain |
| Open Ended + End User | Consumer-facing chat and productivity AI | ChatGPT, Notion AI |
| Open Ended + Developer | Agentic coding and developer-first AI tooling | Claude Code, Cursor |

### Why Wayfinder is Different

Every other tool in this space requires either:
- **a developer** to build and configure it, or
- **an open-ended interaction** with no process governance

Wayfinder is purpose-built for the top-left quadrant: a **procurement officer, HR manager, or ops lead** can run a complex, multi-step, document-producing AI workflow — with confidence tracking, audit logging, and staged governance — without writing a single line of code or prompt.

### Closest neighbours (and why they're still different)

- **Cowork** — personal desktop task automation for individuals; no organisational governance or document generation pipeline
- **Dify** — developer AI app builder; the workflow author must be technical
- **n8n** — integration/automation platform; LLM is one tool among many, not the guide

---

## Release Branching

Two long-lived branch types. Full contributor-facing rules live in
[`CONTRIBUTING.md`](CONTRIBUTING.md); the complete release model and
maintainer runbook live in
[`docs/guides/managing-releases.md`](docs/guides/managing-releases.md).

- `main` — the **next** alpha, in active development. New features land here.
- `release/alpha-N` — the **current** alpha, stabilisation only. Bug fixes and
  enhancements land here; never new features, never a merge from `main`.

**Current alpha branch: `release/alpha-1`** ← skills read the base branch from
this line; update it when a new alpha is cut.

| Skill | Base branch (branch from it, open the PR against it) |
|---|---|
| `/new-feature`, `/build` | `main` |
| `/bugfix`, `/enhance` | Current alpha branch — unless the change only affects unreleased work, then `main` |

---

## Versioning

`VERSION` and root `package.json` `version` must always match. `validate.sh` enforces this.

Each alpha owns a MAJOR line: **alpha-N = the N.x.x line** (alpha-1 = 1.x.x,
alpha-2 = 2.x.x).

- **MAJOR** (x.0.0): New alpha line — bumped on `main` immediately after a `release/alpha-N` branch is cut. Breaking API or domain changes go to `main` (the next alpha), never to a release branch.
- **MINOR** (0.x.0): DB schema change, new phase, new feature
- **PATCH** (0.0.x): Bug fixes, UI tweaks, no schema impact

Every code-writing skill must state the version bump.
