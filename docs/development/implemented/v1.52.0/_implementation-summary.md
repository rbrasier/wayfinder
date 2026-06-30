# Implementation Summary — Flow Skills (v1.52.0)

Phase 1 of the Flow Skills & MCP PRD. Lets a flow author reuse an externally
authored `SKILL.md` in a conversational step. MCP / tool-calling (Phase 2) is not
included; `allowedTools` is parsed and stored but not yet enforced.

- **Version bump**: MINOR — `1.51.0` → `1.52.0` (new feature + new `app_skills` table).
- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/031-runtime-skills-injected-step-instructions.adr.md`
- **Phase doc**: `phase-flow-skills.phase.md` (this directory)

## What was built

A vertical slice across all layers:

- **Domain** — `Skill`/`NewSkill`/`SkillUpdate`/`ParsedSkill`/`ResolvedSkill`
  entities; `ISkillParser` and `ISkillRepository` ports. Extended
  `ConversationalNodeConfig` with `skillRefs` + `inlineSkill`, and
  `BuildSystemPromptInput` with `resolvedSkills`.
- **Adapter** — `SkillParser` (dependency-free YAML-frontmatter parser),
  `app_skills` Drizzle table, `DrizzleSkillRepository`, and a cache-stable
  `<skills>` block in `FlowSessionGraph.buildSystemPrompt` (above per-turn
  retrieved chunks, per ADR-016).
- **Application** — `CreateSkill`, `UpdateSkill`, `ListSkills`, `GetSkill`,
  `ArchiveSkill`, `RestoreSkill`, and `ResolveStepSkills` (config → ordered
  `ResolvedSkill[]`; archived/missing references dropped silently).
- **API/wiring** — `skill` tRPC router (list/get/parse/create/update/archive/
  restore; admin-gated mutations); container registration; skill resolution wired
  into both `buildSystemPrompt` call sites (`route.ts` and `turn-helpers.ts`).
- **UI** — `/admin/skills` library page (paste-to-upload, list, archive/restore),
  a skill picker in the conversational step editor (`skillRefs`), and a sidebar
  link.

## Files

**Created**
- `packages/domain/src/entities/skill.ts`
- `packages/domain/src/ports/skill-parser.ts`
- `packages/domain/src/ports/skill-repository.ts`
- `packages/adapters/src/skills/skill-parser.ts` (+ `.test.ts`, `index.ts`)
- `packages/adapters/src/repositories/drizzle-skill-repository.ts`
- `packages/application/src/use-cases/skill/skill.ts` (+ `.test.ts`, `index.ts`)
- `apps/web/src/server/routers/skill.ts`
- `apps/web/src/app/(admin)/admin/skills/page.tsx` + `_content.tsx`
- `apps/web/e2e/phase-flow-skills.spec.ts`

**Modified**
- `packages/domain/src/entities/flow-node.ts` (config fields), `.../index.ts`
- `packages/domain/src/ports/session-agent.ts` (`resolvedSkills`), `.../index.ts`
- `packages/adapters/src/db/schema/app.ts` (`app_skills`)
- `packages/adapters/src/agents/flow-session-graph.ts` (+ `.test.ts`)
- `packages/adapters/src/repositories/index.ts`, `packages/adapters/src/index.ts`
- `packages/application/src/use-cases/index.ts`
- `apps/web/src/lib/container.ts`, `apps/web/src/server/router.ts`
- `apps/web/src/components/canvas/node-config-modal.tsx`
- `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`
- `apps/web/src/components/canvas/scheduled-node-config.test.ts` (fixture)
- `apps/web/src/components/sidebar.tsx`
- `VERSION`, `package.json`

## Migrations

`app_skills` table added to the Drizzle schema. A migration must be generated and
applied (`pnpm --filter @rbrasier/adapters db:generate && db:migrate`) against a
running Postgres — not run in this environment (no DB).

## Tests

- Unit (vitest, run + passing): `SkillParser` (8), `FlowSessionGraph` skills block
  (2 added), skill use-cases incl. `ResolveStepSkills` ordering/archived-drop (7).
- E2E: `apps/web/e2e/phase-flow-skills.spec.ts` — upload, invalid-upload error, and
  archive. Driven by the `/e2e` skill against a running stack; not executed here
  (no app/DB infra in this environment).

## Known limitations

- **Inline per-step skill**: fully supported in domain/application/prompt, but the
  step editor currently exposes only library references (`skillRefs`). Surfacing
  the inline upload in the editor (which needs parse-on-save) is deferred.
- `allowedTools` is parsed/stored but inert until Phase 2 (MCP).
- Library references resolve to the skill's current version (no per-flow pinning).
- `validate.sh` DB-dependent checks (drizzle) skip without `DATABASE_URL`.
