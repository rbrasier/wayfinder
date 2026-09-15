# /new-feature — New App / Feature Setup

Use this skill when the user wants to plan something new: a feature, bounded
context, new project phase, or a brand-new project bootstrapped from this
template.

**Important:** This skill produces documentation only. Do NOT write code.

New features always target `main` — the next release line — never a `release/*`
branch (see **Release Branching** in `CLAUDE.md`). Plan version bumps against
`main`'s version line.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What problem does this solve? Who uses it?
2. What are the key entities involved?
3. Does it require DB changes? If yes, which group prefix (`core_`, `ai_`, `kb_`, `admin_`, `app_`, `job_`)?
4. What version bump does it warrant? (MINOR / PATCH — MAJOR is reserved for the first stable release)
5. If this is a brand-new project bootstrapped from the template:
   - What is the project name? (used for `@<name>/*` scope, README, docker-compose)
   - Are there existing files to integrate with rather than overwrite?
   - Which LLM provider should be the default? (`anthropic` / `openai` / `mistral`)
   - Should Langfuse observability be enabled day one or stubbed out?

---

## Change Summary — before any doc is written

Once the questions are answered, and before creating a single file, output the
change summary below to the chat as regular markdown. Do **not** put it inside
`AskUserQuestion`.

This skill plans; it does not build. Every section here describes what the
generated docs will specify, not work being carried out now.

**Headline first.** Open with 3–5 lines of plain prose covering the whole
feature, so the user can approve on the headline alone without reading the
sections.

**Then these sections, in this order,** each an `###` heading with bullets under it:

| Section | What it covers |
|---|---|
| Goal | The problem being solved and who it is for, in their terms |
| Business rules changing | Every rule the feature introduces, stated with its triggering condition and resulting behaviour — e.g. "when `status = "approved"`, the document locks and further revisions are rejected" |
| UI / visible behaviour | What the user will see — screens, states, copy, empty and error states — each tied to the type, data structure or rule that drives it |
| Data & types | Domain entities, value objects and TypeScript types the feature introduces, with the shape of each |
| Files & packages touched | The docs to be generated (PRD, ADRs, phase doc) by path, plus the `domain` / `application` / `adapters` / `apps` packages the phase doc will target, so architecture-boundary problems surface at planning time |
| Database & migration impact | Tables and their group prefix, and whether the phase doc will call for a generated migration and its `-- data-impact:` declaration |
| Version, branch & PR target | The MINOR or PATCH bump the feature warrants against `main`'s version line — planned here, applied by `/build`, never by this skill — and the `docs/<slug>/claude-<username>` branch the generated docs land on |
| Risks | What could break, and anything destructive or irreversible |
| Out of scope | What is deliberately not being covered by these docs |

**Omit any section that does not apply** — no heading, no "N/A" placeholder.
Since this skill writes no code, sections with nothing to say simply disappear.

**Cap each section at 5 bullets.** If more are warranted, keep the 5 most
significant and close the section with a single `…and N more` bullet.

### Approval gate

Then use `AskUserQuestion` offering exactly three routes:

- **Approve** — generate the docs as summarised.
- **Approve with notes** — generate the docs immediately, applying the notes
  given. Do not re-show the summary and do not ask a second time.
- **Amend** — revise the summary against the feedback and show it again,
  looping until Approve or Approve with notes is chosen.

Do not generate any doc until one of the two approving routes is chosen.

**Persist it — only once approved.** While the summary is still being amended it
stays in chat only, so no unapproved or superseded version ever reaches a doc.
On Approve or Approve with notes, fold in any notes given and then append the
resulting summary to a doc for this feature, if one already exists. If none
exists yet, leave it in chat — never create a doc just to house it — and carry
the approved summary into the phase doc when the workflow generates it.

---

## Workflow

0. Create the working branch (`docs/<slug>/claude-<username>`) from `main` —
   `<slug>` a short kebab-case description of the feature, `<username>` your
   GitHub login (`gh api user --jq .login`; fall back to the local-part of
   `git config user.email`). This skill writes only docs, so they land on this
   branch off `main`.
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
