# Contributing to Wayfinder

Thanks for considering a contribution. Wayfinder is built almost entirely
using its own AI-assisted development workflow — the same skills described
below are how the maintainers build every feature, so using them isn't
optional tooling on the side, it's the intended way to work in this repo.

Contributions are welcome and accepted under the terms of the
[GNU General Public License v3.0](LICENSE).

---

## 1. Build with the skills, not around them

This repo ships a set of Claude Code skills in `.claude/commands/` that turn
"I want to add X" into a documented, tested, version-bumped change. Pick the
one that matches what you're doing — routing rules are in [`CLAUDE.md`](CLAUDE.md).

| You want to… | Skill |
|---|---|
| Plan a new feature or project phase | `/new-feature` |
| Review a phase doc before building | `/doc-review` |
| Implement a reviewed phase | `/build` |
| Change or extend existing behaviour | `/enhance` |
| Fix something broken | `/bugfix` |

Each skill follows the same shape: **write the spec, write the test, write
the code, validate, document, version, ship.** A few things to know going in:

- `/new-feature` and `/enhance` produce documentation only — a PRD, ADR(s),
  and a phase doc in `docs/development/`. Nothing gets built until `/doc-review`
  passes.
- `/build`, `/enhance`, and `/bugfix` all write the test before the
  implementation, in-memory fakes for ports (never mock what you own), and
  run `./validate.sh` after every sub-component — not just at the end.
- Every code-writing skill finishes by moving its phase doc into
  `docs/development/implemented/v[version]/`, writing an implementation
  summary, and bumping `VERSION` / root `package.json` (they must match).
- If you're not using a skill — a tiny fix, a doc typo — that's fine, but
  still follow the same discipline by hand: test first, `./validate.sh`
  before you're done, version bump if the change touches shipped behaviour.

You don't need to memorise the skill internals; just run `/new-feature`,
`/enhance`, or `/bugfix` and answer the clarifying questions it asks.

## 2. Respect the architecture

Wayfinder follows **hexagonal architecture** (ports and adapters — see
[ADR-001](docs/development/adr/001-hexagonal-architecture.adr.md)). The
short version: business logic must not know which database, AI provider, or
framework it's talking to.

```
packages/domain        entities + port interfaces. Zero external imports, relative imports only.
packages/application   use cases. Imports @rbrasier/domain and @rbrasier/shared only — no frameworks, no ORMs, no AI SDKs.
packages/adapters       implements domain ports — Drizzle, Vercel AI SDK, LangGraph.js, Langfuse, Better Auth.
apps/web / apps/api    imports @rbrasier/application and @rbrasier/adapters only. Wiring lives in lib/container.ts.
```

This is enforced by ESLint and `validate.sh`, not just convention — a PR
that violates it won't pass checks. The rules that matter most day to day:

- **Never throw across a package boundary.** Every port method returns
  `Result<T> = { data: T } | { error: DomainError }`.
  Add a new port? Follow the pattern in [`packages/domain/src/ports/`](packages/domain/src/ports/).
- **Domain entities are plain TypeScript.** No decorators, no ORM
  annotations, no framework imports of any kind.
- **DB conventions**: tables are prefixed by group (`core_`, `ai_`, `kb_`,
  `admin_`, `app_`, `job_`), columns are snake_case, and every table has
  `id` (uuid), `created_at`, `updated_at`.
- **Code style**: return early — never nest more than 2 levels deep;
  descriptive names, no abbreviations; comments explain *why*, never *what*.

### Common extension points

**Adding a node executor** — executors live in
`packages/adapters/src/node-executors/` and implement `INodeExecutor` from
[`packages/domain/src/ports/node-executor.ts`](packages/domain/src/ports/node-executor.ts).

1. Write `my-executor.test.ts` before `my-executor.ts`
2. Export it from `packages/adapters/src/node-executors/index.ts`
3. Wire it into `apps/web/src/lib/container.ts`

**Adding a domain port**

1. Define the interface in `packages/domain/src/ports/`
2. Export it from `packages/domain/src/ports/index.ts`
3. Implement it in `packages/adapters/src/`
4. Wire the implementation via the container

**Adding a document template** — templates are `.docx` files using
`{{tag}}` placeholders (docxtemplater syntax). Drop examples in
`docs/templates/` and upload real ones via the admin canvas.

## 3. Running checks

```bash
./validate.sh
```

All checks must pass before a PR can merge.

## Commit style

```
feat: add MinIO storage adapter
fix: handle null branchChoice after three retries
chore: bump version to 1.5.0
```
