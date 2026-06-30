# ADR-031 — Runtime Skills as Injected Step Instructions

- **Status**: Proposed
- **Date**: 2026-06-30
- **Relates to**: Flow Skills & MCP PRD, ADR-016 (prompt structure / cache),
  ADR-032 (MCP integration — the `allowed-tools` bridge)

## Context

Flow authors steer a conversational step with the free-text `aiInstruction` field
(`ConversationalNodeConfig`). The wider ecosystem distributes reusable expertise
as **`SKILL.md`** files — YAML frontmatter (`name`, `description`, optional
`allowed-tools`, etc.) plus a markdown body of instructions, sometimes with
bundled scripts/assets. Authors want to drop such a skill into a Wayfinder step
without retyping it, and to reuse the same skill across flows.

Note: the repo's existing `docs/guides/skills.md` describes Claude Code's
*authoring-time* routing layer. That is unrelated to this ADR. "Skill" here means
a **runtime** artefact that shapes a conversational step's behaviour.

Two shapes were considered for how a skill attaches to a step:

1. **Inline only** — paste the SKILL.md onto a node; lives in `flow_nodes.config`.
   Simple, but no reuse and no governance.
2. **Library only** — upload once into a managed store; steps reference by id.
   Reuse + governance, but blocks quick one-offs.

## Decision

### Support both: a reusable library *and* an inline per-step override

- A new **`app_skills`** table holds reusable skills (name, description,
  `frontmatter` jsonb, `body` text, `allowed_tools` jsonb, `version` int, `status`).
  Updating a skill bumps its `version`; references resolve to the current version
  (flow-level pinning is deferred — see Consequences).
- `ConversationalNodeConfig` gains:
  - `skillRefs?: string[]` — ids of library skills applied to the step.
  - `inlineSkill?: ParsedSkill` — a one-off skill stored only in the node config.
  Both may be present; inline is appended after referenced skills.

### A skill is parsed, not executed

A `SKILL.md` is parsed into a `ParsedSkill` value:

- `name`, `description` — from frontmatter (fall back to first heading / filename).
- `body` — the markdown instructions.
- `allowedTools` — from the frontmatter `allowed-tools` list, normalised to
  `McpToolRef`s where they resolve to a registered MCP tool (ADR-032). This is the
  **only** bridge between a skill and tool access.

Anything else a skill bundles — scripts, binaries, file references — is **ignored
at runtime**. Wayfinder never executes skill-bundled code; a skill contributes
instructions and a tool-allowance declaration, nothing more. Parsing lives behind
`ISkillParser` (adapter), returning `Result<ParsedSkill>` — a malformed file is a
`DomainError`, never a throw.

### Skills inject as a dedicated, cache-stable prompt block

`buildSystemPrompt` (`FlowSessionGraph`) gains a `<skills>` block, placed as a
sibling of the existing `<global_instructions>` block — i.e. in the **stable**
region of the prompt, above the per-turn `<reference_documents>` chunks, to
preserve prompt-cache hits (ADR-016 Decision 5). Each applied skill renders as:

```
<skill name="...">
  ...body...
</skill>
```

Referenced (library) skills render first, in author order; the inline skill last.
Skills shape *how* the step behaves; they do not replace `aiInstruction`,
`doneWhen`, or the structured `<output>` contract — those remain authoritative.

### `allowed-tools` is advisory at author time, enforced at runtime by MCP

A skill naming tools that are not registered MCP tools is **not** fatal: its
instructions still inject, and the editor surfaces the unresolved names as a
warning. Actual tool access for a conversational step is governed by the node's
`allowedMcpToolRefs` (ADR-032), which the editor pre-populates from the applied
skills' `allowedTools`. Injecting prose and granting tool access are deliberately
separate concerns.

## Consequences

**Positive**

- Authors reuse external skills with one upload; the library gives a single place
  to govern and version them.
- Inline override keeps experimentation friction-free with no library clutter.
- The cache-stable `<skills>` block adds capability without disturbing the
  generation mechanism or the per-turn cost profile.
- "Ignore bundled code" keeps the security surface small: a skill is text, not an
  execution vector.

**Negative**

- Two attachment paths (refs + inline) mean two code paths in the editor and in
  prompt assembly. Mitigated by both resolving to the same `ParsedSkill` list
  before injection.
- Library skills resolve to their **current** version, so editing a skill changes
  every referencing flow's behaviour. Acceptable for v1; per-flow version pinning
  is deferred until an author hits the need (YAGNI), and `flow_versioning` already
  gives a snapshot escape hatch.
- Large skill bodies consume context budget. Surfaced as an editor concern, not a
  hard limit, in this ADR.

## Alternatives considered

- **Fold the skill body into `aiInstruction`.** Rejected: no reuse, no governance,
  and it conflates author intent with imported expertise.
- **Treat skills as RAG documents.** Rejected: skills are behavioural instructions
  that must apply every turn deterministically, not retrieved-on-relevance chunks.
