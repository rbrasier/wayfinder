# Phase — Flow Skills (v2.1.0)

**Status:** Implemented
**Version:** 2.1.0 (MINOR — new `app_skills` table)
**PRD:** flow-skills-and-mcp · **ADR:** ADR-031 (skills as cache-stable prompt blocks)

> Migrated onto the alpha-2 line from the fork's original v1.52.0 phase. This is
> Phase 1 of the Flow Skills & MCP arc; MCP/tool-calling lands in later phases.

## Goal

Let a flow author upload an externally-authored `SKILL.md` to a shared library
and attach one or more skills to a conversational step. At prompt-build time the
attached skill bodies are injected into the step's system prompt as a
cache-stable `<skills>` block, steering the AI without the author writing prompt
scaffolding.

## Scope

- Upload / list / archive / restore skills in an admin library (`/admin/skills`).
- Parse `SKILL.md` (YAML frontmatter + markdown body) into a stored skill;
  `allowed-tools` is parsed and stored but **not** enforced yet (Phase 2 / MCP).
- Attach library skills to a conversational step via the step editor; resolve
  them (author order, inline skill last, archived silently dropped) and render a
  `<skills>` block above the per-turn retrieved chunks.

## Design

- **domain** — `Skill` / `ParsedSkill` / `ResolvedSkill` entities;
  `ISkillParser` + `ISkillRepository` ports; `ConversationalNodeConfig` gains
  `skillRefs` and `inlineSkill`; `BuildSystemPromptInput` gains `resolvedSkills`.
- **application** — `CreateSkill` / `UpdateSkill` / `ListSkills` / `GetSkill` /
  `ArchiveSkill` / `RestoreSkill`, plus `ResolveStepSkills` (refs in author
  order, inline appended, archived/missing dropped — a missing skill never fails
  a turn).
- **adapters** — dependency-free `SkillParser`; `app_skills` table +
  `DrizzleSkillRepository`; `<skills>` block in `FlowSessionGraph`.
- **web** — `skill` tRPC router; container wiring; skill resolution at both chat
  call sites (turn stream + initial message); `/admin/skills` library page; skill
  picker on the conversational node editor.

## Out of scope

- Tool calling / MCP enforcement of `allowed-tools` (later phase).
- Per-user (non-admin) skill authoring; skills are admin-managed in this phase.

## Version

MINOR: `2.0.1 → 2.1.0` (new `app_skills` table, migration `0029`).
