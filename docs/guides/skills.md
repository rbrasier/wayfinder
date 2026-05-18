# The Skill System

This template uses a **skill routing layer** in `CLAUDE.md` to make
Claude Code's behaviour predictable across a project's lifecycle.

Every prompt is routed to one of five skills. Each skill has a documented
workflow that produces (a) documentation, then (b) code, then runs
`./validate.sh`.

## How routing works

1. Claude Code reads the prompt.
2. It picks the matching skill from `CLAUDE.md` → "Skill Routing Rules".
3. It announces the choice: `Applying skill: [name] because [reason]`.
4. It asks any clarifying questions the skill requires.
5. It runs the workflow.
6. It runs `./validate.sh` and fixes any failures before declaring done.

If the prompt doesn't clearly match a skill, Claude asks:

> Is this planning, a review, an implementation, a change to existing
> functionality, or a bug fix?

…and then routes accordingly.

## The five built-in skills

| Skill                       | Triggers when…                                                     | Output                                   |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------------------- |
| New App / Feature Setup     | "let's plan…", "design a…", new bounded context                    | PRD + ADR + phase doc (no code)          |
| Documentation Review        | "review docs", "let's build this"                                  | PASS/WARN/FAIL report (no code)          |
| Build — New Phase / Feature | "implement phase X", "build the spec"                              | Code + moved phase doc + impl summary    |
| Enhancement / Revision      | "change…", "extend…", "tweak…"                                     | Updated phase doc → routed to Review     |
| Bug Fix                     | "broken", "not working", "should be doing"                         | Fix doc + code + impl summary + PATCH    |

## Adding a new skill

1. Open `CLAUDE.md` and add a new `### Skill: <name>` section under
   "Skill Routing Rules". Specify:
   - **Triggers when**: a one-line condition Claude can match against a prompt.
   - **Required clarifying questions**: a numbered list. Skip if none.
   - **Workflow**: ordered steps. End with "run `validate.sh`" if the skill
     writes code.
2. Add a row to the "Quick Reference" table at the bottom of `CLAUDE.md`.
3. Update this file's table above.
4. If the skill produces a new doc category, add a directory under
   `docs/development/` and link from `docs/guides/versioning.md`.

## Skill design rules

- **Documentation before code**: skills that produce code MUST have a phase
  doc in `to-be-implemented/` first. The Build skill moves it to
  `implemented/v[version]/` on completion.
- **One responsibility per skill**: don't combine planning and building.
  Split into two steps with the Documentation Review skill in between.
- **Versioning is mandatory**: every code-writing skill must specify the
  version bump in its implementation summary. `validate.sh` enforces that
  `VERSION` matches root `package.json#version`.
- **Validate before declaring done**: every workflow ends with
  `./validate.sh`. If it fails, fix and re-run before reporting completion.

## What the skill system is NOT

- It is not a state machine — Claude does not "transition" between skills.
  Each prompt picks one skill from scratch.
- It is not a CLI — there's no `npm run skill:plan`. The router lives entirely
  in `CLAUDE.md` and is interpreted by Claude Code on every turn.
- It is not opinionated about your domain — skills target the *process* of
  building (plan → review → build → revise → fix), not the content.
