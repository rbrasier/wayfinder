# /new-feature — New App / Feature Setup

Use this skill when the user wants to plan something new: a feature, bounded
context, new project phase, or a brand-new project bootstrapped from this
template.

**Important:** This skill produces documentation only. Do NOT write code.

---

## Required Clarifying Questions

Ask all of these before proceeding:

1. What problem does this solve? Who uses it?
2. What are the key entities involved?
3. Does it require DB changes? If yes, which group prefix (`core_`, `ai_`, `kb_`, `admin_`, `app_`, `job_`)?
4. What version bump does it warrant? (MAJOR / MINOR / PATCH)
5. If this is a brand-new project bootstrapped from the template:
   - What is the project name? (used for `@<name>/*` scope, README, docker-compose)
   - Are there existing files to integrate with rather than overwrite?
   - Which LLM provider should be the default? (`anthropic` / `openai` / `mistral`)
   - Should Langfuse observability be enabled day one or stubbed out?

---

## Workflow

1. Generate a PRD in `docs/development/prd/` using `docs/development/prd/template.prd.md` as the starting point.
2. If architectural decisions are needed, generate ADR(s) in `docs/development/adr/`.
3. Generate a phase doc in `docs/development/to-be-implemented/`.

If this is a brand-new project, also document:
- Which packages need `@template/` → `@<name>/` replacement
- Which files in `docker-compose.yml`, `.env.example`, and `README.md` need updating
- The `pnpm install` step to regenerate the lockfile

---

## Output

- PRD file: `docs/development/prd/<feature-name>.prd.md`
- ADR file(s): `docs/development/adr/<NNN>-<decision>.adr.md` (if needed)
- Phase doc: `docs/development/to-be-implemented/<feature-name>.phase.md`

Do not proceed to `/doc-review` automatically — let the user review the docs first.
