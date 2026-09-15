# Implementation Summary — A fixed PR body template for the skills that open PRs

- **Version**: 0.28.9 (bump: **PATCH** — skill instructions and repository
  documentation only; no product code, no schema impact)
- **Base branch**: `release/alpha-2`
- **Type**: `/enhance`
- **Phase doc**: [`skills-pr-body-template.phase.md`](./skills-pr-body-template.phase.md)

## What was built

A single `.github/pull_request_template.md` now defines the body of every
Wayfinder pull request, and the four skills that open PRs fill it instead of
composing a structure of their own.

### The template

Four sections, always in this order:

| Section | Content |
|---|---|
| `## Summary` | One paragraph — what the change does and what it means for the product |
| `## Impact` | **Features affected** (checklist drawn from the app's real route groups) and **Business rules changed** (one bullet per rule, each with its trigger and resulting behaviour) |
| `## UI Impact` | Bullets on how a user experiences the change, in the user's terms |
| `## Why this change is required` | The use case being served or the problem being solved |

Implementation detail sits in a collapsed `<details>` block at the foot,
prompting for the six facts the skills already required: version bump, files
created and modified, migrations with their `-- data-impact:` line, tests
including the e2e decision, known limitations, and deviations from the approved
change summary.

The feature checklist is taken from the actual route groups rather than
invented, so it stays checkable: user-facing (`chats`, `flows`, `synthesise`,
`knowledge`, `approvals`, `settings`), the sixteen admin areas, reporting, and
the cross-cutting layers (auth and sessions, `apps/api`, background jobs,
framework packages).

**Non-applicable sections carry a one-line reason** — "No UI impact —
server-side only" — never a deleted heading and never a bare `N/A`. That is
what distinguishes "considered, and there is none" from "not thought about".

### The skills

Each of the four PR steps was rewritten to read the template and map its own
approved change summary onto it, rather than being told to "build the PR body
from the approved change summary" and left to choose a shape. Every skill now
carries an explicit mapping table next to its PR step:

- **`/build`** (Step 4) — Step 0 headline + **Goal** → Summary;
  **Business rules changing** → Impact; **UI / visible behaviour** → UI Impact;
  the PRD and phase doc rationale → Why; **Files & packages touched**,
  **Database & migration impact**, **Tests**, **Version** → implementation block.
- **`/enhance`** (step 5) — the same mapping against the `/enhance` change
  summary, with Why drawn from the answer to clarifying question 1.
- **`/bugfix`** (Step 6) — Why carries the symptom and the **verified** root
  cause (the mechanism, not the symptom restated); UI Impact carries what the
  user stops seeing and what they see instead; Impact notes where the bug's
  reach was wider than the fix's; the implementation block carries the fix and
  the regression test that now guards it.
- **`/release`** — Operation A gains body guidance it never had (a line cut has
  no business rules and no UI impact, so those sections carry reason lines,
  while Summary and Why cover which line is being frozen and why now).
  Operation C gains the same for the protected-`main` forward-merge case.

The "corrected to describe what was actually implemented rather than what was
planned" rule survives in all three code skills — it is the reason the body is
built from the approved summary rather than restating it.

### Contributor documentation

`CONTRIBUTING.md` gains a §5 "Opening a pull request" describing the four
sections and the one-line-reason rule, so a human opening a PR by hand meets the
same standard the skills do. `docs/guides/skills.md` gains a
"The pull request body" section explaining that changing the one template
changes every skill's output.

## Files created / modified

**Created**

- `.github/pull_request_template.md`

**Modified**

- `.claude/commands/build.md` — Step 4 PR bullets
- `.claude/commands/enhance.md` — step 5 PR bullets
- `.claude/commands/bugfix.md` — Step 6 PR bullets
- `.claude/commands/release.md` — Operation A step 4, Operation C step 4
- `CONTRIBUTING.md` — new §5
- `docs/guides/skills.md` — new "The pull request body" section
- `VERSION`, `package.json` — 0.28.8 → 0.28.9

No package code was touched. `domain`, `application`, `adapters` and `apps` are
untouched, so no architecture boundary is in play.

## Migrations

None. No schema change.

## Tests

**No test files.** The deliverable is skill instructions and a GitHub template —
there is no executable behaviour to assert, and no coverage is displaced to
another layer because there is nothing to cover.

**No e2e.** Documentation only; nothing falls into any of the six groups in
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md).

Acceptance was verified by inspection against the nine criteria in §5 of the
phase doc — all nine pass, including that `pull_request_template` is now
referenced in all four skill files and that the old free-form
"Build the PR body from the approved … change summary" instruction no longer
appears anywhere in `.claude/commands/`.

`./validate.sh` passes, with `VERSION` and root `package.json` both at `0.28.9`.

## Known limitations

- **The feature checklist is a snapshot.** It reflects today's route groups. A
  new admin or user area added later needs a line adding to the template, or it
  will silently under-report. Accepted: the list is a prompt, not a validated
  enum.
- **No CI enforcement.** The template is convention. A gate would block PRs on
  body formatting, which costs more than it saves at this stage.
- **Ceremony on trivial PRs.** A typo fix carries four sections it barely needs.
  Mitigated by the one-line "does not apply" rule rather than by an exemption,
  which would be gamed.

## Deviations from the approved change summary

One, and it is an addition rather than a change: the phase doc gained a §5
**Acceptance criteria** section during `/doc-review`, because check 7
(testable acceptance criteria) had nothing to score against. The nine criteria
describe the same deliverables the approved summary listed — they only make
them checkable. Section numbering shifted accordingly (Tests 5→6, Risks 6→7,
Out of scope 7→8).

Nothing else deviates. All four skills, both contributor docs, and the
collapsed implementation block landed as approved.

## Reaching `main`

This lands on `release/alpha-2`. The skill files were byte-identical on
`release/alpha-2` and `main` at the time of the change, so `/release` →
**Forward-merge** (Operation C) carries it to `main` without conflict.
