# Implementation Summary — Flow Skills (v2.1.0)

Migrated the fork's Flow Skills feature (originally v1.52.0) onto the alpha-2
base. Flow authors can upload a `SKILL.md`, manage a skill library, and attach
skills to conversational steps; attached skills render as a cache-stable
`<skills>` block in the step's system prompt (ADR-031).

## What was built

- Skill library (upload / list / archive / restore) at `/admin/skills`.
- `SKILL.md` parser (frontmatter + body + `allowed-tools`), stored per skill.
- Skill picker on the conversational node editor; refs persisted to node config.
- Skill resolution wired into both chat prompt-build call sites; `<skills>`
  block rendered above per-turn retrieved chunks to preserve prompt-cache hits.

## Files created

- `packages/domain/src/entities/skill.ts`
- `packages/domain/src/ports/skill-parser.ts`, `skill-repository.ts`
- `packages/application/src/use-cases/skill/{skill.ts,skill.test.ts,index.ts}`
- `packages/adapters/src/skills/{skill-parser.ts,skill-parser.test.ts,index.ts}`
- `packages/adapters/src/repositories/drizzle-skill-repository.ts`
- `packages/adapters/drizzle/0029_odd_misty_knight.sql`
- `apps/web/src/server/routers/skill.ts`
- `apps/web/src/app/(admin)/admin/skills/{page.tsx,_content.tsx}`
- `tests/e2e/phase-flow-skills.spec.ts`
- `docs/development/implemented/alpha-2/v2.1.0/{phase-flow-skills.phase.md,_implementation-summary.md}`

## Files modified

- domain: `entities/index.ts`, `ports/index.ts`, `entities/flow-node.ts`
  (`skillRefs`/`inlineSkill`), `ports/session-agent.ts` (`resolvedSkills`)
- adapters: `db/schema/app.ts` (`app_skills`), `agents/flow-session-graph.ts`
  (`<skills>` block) + test, `index.ts`, `repositories/index.ts`
- application: `use-cases/index.ts`
- web: `server/router.ts`, `lib/container.ts`, both chat call sites
  (`app/api/chat/[sessionId]/stream/route.ts`, `turn-helpers.ts`),
  `components/sidebar.tsx`, `components/canvas/node-config-modal.tsx`,
  `app/(admin)/admin/flows/[id]/_content.tsx`,
  `components/canvas/scheduled-node-config.test.ts` (fixture)

## Migrations

- `0029_odd_misty_knight.sql` — creates `app_skills` (fk → `core_users`, status
  index). Run `pnpm db:migrate` against a live database.

## Tests

- Unit (run green in this session): 11 application use-case, 8 parser,
  2 new `<skills>` prompt-block assertions (31 total in the graph suite).
- e2e: `tests/e2e/phase-flow-skills.spec.ts` — upload/library/archive +
  validation-error path. Requires a running stack + Postgres/Redis/MinIO; not
  executed in the migration sandbox.

## Known limitations / deferred

- `allowed-tools` is parsed and stored but not enforced (MCP arrives in a later
  phase).
- Skills are admin-managed only; no inline per-step upload UI in this phase
  (the `inlineSkill` domain path exists but is not surfaced in the editor yet).
- Full `./validate.sh` (and the e2e) could not run in the migration sandbox
  (no Postgres/Redis/MinIO; pnpm bin symlinks unresolved). Core logic verified
  via direct vitest runs; web app typechecks clean apart from pre-existing
  `.css` ambient-declaration noise present on the base.
