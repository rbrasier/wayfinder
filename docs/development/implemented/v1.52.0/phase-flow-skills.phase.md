# Phase — Flow Skills (SKILL.md → conversational step)

> Phase 1 of the Flow Skills & MCP PRD. Phase 2 (MCP) is a separate phase doc.

- **PRD**: `docs/development/prd/flow-skills-and-mcp.prd.md`
- **ADR**: `docs/development/adr/031-runtime-skills-injected-step-instructions.adr.md`
- **Target version**: 1.52.0 (MINOR — new feature + DB table)

## Scope

Let a flow author reuse an externally-authored `SKILL.md` in a conversational
step, either from a reusable library or as a one-off inline upload. Skill bodies
are injected into the step's system prompt as a cache-stable `<skills>` block.
MCP/tool-calling is **not** in this phase — `allowedTools` is parsed and stored
but not yet enforced against any tool runtime.

## Sub-components (build in order)

1. **Domain** — `Skill`/`NewSkill`/`ParsedSkill`/`ResolvedSkill` entities;
   `ISkillParser` and `ISkillRepository` ports; extend `ConversationalNodeConfig`
   with `skillRefs?: string[]` + `inlineSkill?: ParsedSkill`; extend
   `BuildSystemPromptInput` with `resolvedSkills?: ResolvedSkill[]`.
2. **Adapter** — `SkillParser` (dependency-free frontmatter parse), `app_skills`
   Drizzle table, `DrizzleSkillRepository`, and the `<skills>` block in
   `FlowSessionGraph.buildSystemPrompt`.
3. **Application** — `CreateSkill` (parse + store), `ListSkills`, `GetSkill`,
   `ArchiveSkill`, `ResolveStepSkills` (config → `ResolvedSkill[]`).
4. **Wiring** — register parser/repo/use-cases in the container; `skill` tRPC
   router; resolve skills at both `buildSystemPrompt` call sites.
5. **UI + finish** — skills library page, step-editor skill picker, Playwright
   e2e, version bump, move this doc, write summary, `validate.sh` green.

## Acceptance (subset of PRD §10 in scope this phase)

- [ ] Valid SKILL.md parses to name/description/body/allowedTools; invalid →
      `VALIDATION_FAILED` DomainError (no throw).
- [ ] A step with `skillRefs` renders each active skill body in `<skills>`,
      above per-turn retrieved chunks.
- [ ] An inline skill applies with no library row.
- [ ] Archived skills are excluded from resolution.
- [ ] `app_skills` matches the `app_` prefix rule; `validate.sh` passes.

## Out of scope (Phase 2)

`allowedTools` enforcement, MCP servers, the `mcp` node, conversational
tool-calling. Per-flow skill version pinning.
