# Enhancement — A fixed PR body template for the skills that open PRs

- **Status**: Implemented in 0.28.9 (`/doc-review`: PASS, one WARN — no PRD, correct for a skill-layer process change)
- **Target version**: **PATCH** — 0.28.8 → 0.28.9 (skill instructions and
  repository documentation only; no product code, no schema impact)
- **Base branch**: `release/alpha-2` (reaches `main` via `/release` →
  Forward-merge; the skill files are byte-identical on both branches today)
- **Type**: `/enhance`
- **PRD / ADR**: none — this is a process change to the skill layer, not a
  product capability

## 1. Goal

A reviewer opening a Wayfinder pull request should be able to tell, from the
body alone, what the change means for the product — which features it moves,
which business rules it alters, what the user will see differently, and why it
was needed — without reading the diff.

Today they cannot, because nothing prescribes the shape of a PR body.

## 2. The problem

Four skills open pull requests:

| Skill | Where | Target |
|---|---|---|
| `/build` | Step 4 — On completion | `main` |
| `/enhance` | Step 5 — On completion | base branch chosen at question 5 |
| `/bugfix` | Step 6 — On completion | base branch chosen at Step 0 |
| `/release` | Operation A — Cut the next release line | `main` |

The three code skills each carry a near-identical instruction:

> **Build the PR body from the approved change summary**, corrected to describe
> what was actually implemented rather than what was planned, and add the
> implementation detail the summary could not know up front: …

Three problems follow from it:

1. **No structure is prescribed.** "Build the body from the summary" leaves the
   headings, their order and their depth to whatever the run produces. Two PRs
   for comparable changes come out looking nothing alike.
2. **Implementation detail leads.** The only *specific* guidance each skill
   gives is the tail of implementation facts — files created, migrations
   generated, version bump, e2e coverage, deviations. That is what reliably
   reaches the body, so bodies open on file lists rather than on what changed
   for the product.
3. **Humans get nothing.** There is no `.github/pull_request_template.md` in
   the repository, so a PR opened by hand in the GitHub UI starts from an empty
   box. Only `ci.yml`, `e2e.yml` and `publish.yml` live under `.github/`.

`/release` Operation A gets no body guidance at all — just "open a PR against
`main` via `mcp__github__create_pull_request`".

## 3. Approach

Define the body **once**, in `.github/pull_request_template.md`, and have every
skill fill that structure rather than improvise one. GitHub pre-fills the same
file for anyone opening a PR through the web UI, so both routes converge on one
shape and there is a single place to change it.

### 3.1 The four sections

In this order, always:

| Section | Content |
|---|---|
| `## Summary` | One paragraph. What the change does and what it means for the product. |
| `## Impact` | **Features affected** — named from the app's real areas. **Business rules changed** — bullets, each stating trigger and resulting behaviour. |
| `## UI Impact` | Bullets describing how a user experiences the change, written as the user would describe it. |
| `## Why this change is required` | One paragraph or bullets: the use case being served or the problem being solved. |

The feature vocabulary is taken from the application's actual route groups, so
the list stays checkable rather than aspirational:

- **User** (`apps/web/src/app/(user)`): chats, flows, synthesise, knowledge,
  approvals, settings
- **Admin** (`apps/web/src/app/(admin)/admin`): users, roles, groups,
  organisations, flows, skills, schedules, mcp-servers, settings, audit, usage,
  errors, flags, sessions, dashboards
- **Cross-cutting**: auth and sessions, `apps/api`, background jobs

### 3.2 Implementation detail

Still mandatory, but demoted. It moves into a collapsed `<details>` block after
the four sections, carrying exactly what the skills ask for today: version bump,
files created and modified, migrations generated with the `-- data-impact:` line,
tests added and the e2e spec extended (or the explicit "no e2e — covered at
`<layer>`"), known limitations, and any deviation from the approved change
summary.

### 3.3 Sections that do not apply

Filled with a one-line reason — "No UI impact — server-side only", "No business
rules changed — documentation only". Never deleted, never left as a bare `N/A`.
A cut release line legitimately has no business rules and no UI impact; the
reason line is what distinguishes "considered and none" from "not thought
about".

## 4. Changes

### `.github/pull_request_template.md` — new

The template itself, with HTML comments as the filling instructions.

### `.claude/commands/build.md` — Step 4

Replace the "Build the PR body from the approved Step 0 change summary…"
sentence with an instruction to fill `.github/pull_request_template.md`,
mapping the Step 0 summary sections onto it:

- Step 0 **Goal** + headline → `## Summary`
- Step 0 **Business rules changing** → `## Impact` → Business rules changed
- Step 0 **UI / visible behaviour** → `## UI Impact`
- The phase doc's rationale → `## Why this change is required`
- Step 0 **Files & packages touched**, **Database & migration impact**,
  **Tests**, **Version** → the collapsed implementation block

The "corrected to describe what was actually implemented rather than what was
planned" rule survives unchanged — it is the point of building from the
approved summary rather than restating it.

### `.claude/commands/enhance.md` — step 5

Same substitution, against the `/enhance` change summary's sections.

### `.claude/commands/bugfix.md` — Step 6

Same substitution. `## Why this change is required` carries the bug report and
the verified root cause; the implementation block carries the fix applied and
the regression test that now guards it.

### `.claude/commands/release.md` — Operation A (and Operation C)

Operation A gains explicit body guidance: `## Summary` names the line being
cut and the pointer updates; `## Impact` lists the pointer files touched and
records "no business rules changed — release-line bookkeeping"; `## UI Impact`
records "none — no application change"; `## Why` states which line is being
frozen and why now. Operation C gains the same instruction for the case where
`main` is protected and the forward-merge has to go through a PR.

### `CONTRIBUTING.md` and `docs/guides/skills.md`

A short pointer at the template so a human contributor meets the same rule the
skills follow.

## 5. Acceptance criteria

Each is checkable by inspection — there is no runtime behaviour to assert.

1. `.github/pull_request_template.md` exists and contains exactly the four
   headings `## Summary`, `## Impact`, `## UI Impact`,
   `## Why this change is required`, in that order, followed by one
   `<details>` block.
2. `## Impact` contains both a **Features affected** line and a
   **Business rules changed** list.
3. The `<details>` block prompts for all six facts the skills currently
   require: version bump, files created/modified, migrations with the
   `-- data-impact:` line, tests including the e2e decision, known
   limitations, deviations from the approved summary.
4. Grepping `.claude/commands/` for `pull_request_template` returns a hit in
   each of `build.md`, `enhance.md`, `bugfix.md` and `release.md`.
5. No skill still instructs the model to compose a PR body of its own shape —
   the phrase "Build the PR body from the approved … change summary" no longer
   appears as a free-form instruction in any of the three code skills.
6. Each of the three code skills states which of its own change-summary
   sections feeds which template section.
7. `/release` Operation A states what to put in each section for a line cut,
   including the "does not apply" reason lines.
8. `CONTRIBUTING.md` and `docs/guides/skills.md` each reference the template
   by path.
9. `./validate.sh` passes, with `VERSION` and root `package.json` both at
   `0.28.9`.

## 6. Tests

No test files. There is no executable behaviour here — the deliverable is skill
instructions and a GitHub template.

**No e2e.** Documentation only; nothing falls into any of the six groups in
[`e2e-test-policy.md`](../../../../guides/e2e-test-policy.md). Coverage is not
displaced to another layer because there is nothing to cover.

`./validate.sh` runs to confirm the version-sync check passes after the bump.

## 7. Risks

- The feature list in the template is a snapshot of today's route groups. A new
  area added later needs a line adding here, or it silently under-reports.
  Accepted: the list is a prompt, not a validated enum.
- The four sections are prescriptive, so a one-line typo fix carries more
  ceremony than it needs. Mitigated by the one-line "does not apply" rule
  rather than by an exemption, which would be gamed.
- No CI check enforces the template. It is convention. Adding a gate would
  block PRs on body formatting, which costs more than it saves at this stage.

## 8. Out of scope

- **When** a PR is opened, and which base branch it targets — unchanged in all
  four skills.
- The approval gates and change summaries inside the skills — unchanged. This
  changes only what happens to that summary once the work is done.
- `/new-feature`, `/doc-review`, `/publish`, `/e2e` and `/e2e-cc-web` — none of
  them open pull requests.
- Any CI enforcement of the template.
