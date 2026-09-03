# /enhance — Enhancement / Revision

Use this skill when the user wants to change or extend something already built.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What's changing, and why?
2. Which entities or use cases are affected?
3. Are DB changes needed?
4. Is this a MINOR or PATCH bump? **A change targeting a release branch
   (`release/*`) is always a PATCH** — MINOR bumps only ever land on `main`.
   Only ask this question when the target is `main`; otherwise it's PATCH.
5. Which release does this target? Default is the current release branch (see
   **Release Branching** in `CLAUDE.md`); choose `main` only if it extends
   unreleased work. If the change is really a new feature, stop and route to
   `/new-feature` instead — release branches take no new features.

---

## Change Summary — before any code is written

Once the questions are answered, and before creating or editing a single file,
output the change summary below to the chat as regular markdown. Do **not** put
it inside `AskUserQuestion`.

**Headline first.** Open with 3–5 lines of plain prose covering the whole
enhancement, so the user can approve on the headline alone without reading the
sections.

**Then these sections, in this order,** each an `###` heading with bullets under it:

| Section | What it covers |
|---|---|
| Goal | The outcome in the user's terms — what becomes possible that isn't today, not the implementation |
| Business rules changing | Every rule added, altered or removed, stated with its triggering condition and resulting behaviour — e.g. "when `status = "approved"`, the document locks and further revisions are rejected" |
| UI / visible behaviour | What the user will see differently — screens, states, copy, empty and error states — each tied to the type, data structure or rule that drives it |
| Data & types | Domain entities, value objects and TypeScript types created or changed, with the shape of each change |
| Files & packages touched | Paths to create, modify or delete, grouped under `domain` / `application` / `adapters` / `apps`, so architecture-boundary violations are visible before any code exists |
| Database & migration impact | Tables and their group prefix, whether a generated migration is required, and the `-- data-impact:` line it will have to carry |
| Tests | The test files written before each sub-component, and either the named Playwright e2e spec that will be extended (with the `e2e-test-policy.md` group it falls under) or an explicit "no e2e — behaviour is covered at `<layer>`" |
| Version, branch & PR target | The bump and resulting version — PATCH when the base branch is a `release/*` branch, MINOR or PATCH only when the base is `main` — the `enhance/<slug>` branch name, the base branch, and the branch the PR opens against |
| Risks | What could break, and anything destructive or irreversible |
| Out of scope | What is deliberately not being done |

**Omit any section that does not apply** — no heading, no "N/A" placeholder.

**Cap each section at 5 bullets.** If more are warranted, keep the 5 most
significant and close the section with a single `…and N more` bullet.

### Approval gate

Then use `AskUserQuestion` offering exactly three routes:

- **Approve** — start the workflow as summarised.
- **Approve with notes** — start the workflow immediately, applying the notes
  given. Do not re-show the summary and do not ask a second time.
- **Amend** — revise the summary against the feedback and show it again,
  looping until Approve or Approve with notes is chosen.

Do not start the workflow until one of the two approving routes is chosen.

**Persist it — only once approved.** While the summary is still being amended it
stays in chat only, so no unapproved or superseded version ever reaches a doc.
On Approve or Approve with notes, fold in any notes given and then append the
resulting summary to the implementation doc for this change, if one already
exists. If none exists yet, leave it in chat — never create a doc just to house
it — and carry the approved summary into the phase doc when step 1 generates it.

---

## Workflow

0. Create the working branch (`enhance/<slug>`) from the base branch chosen in
   question 5. The PR at the end must target that same base branch.
1. Generate an updated phase doc in `docs/development/to-be-implemented/` describing
   what changes and why — do not start coding yet.
2. Run `/doc-review` on the new phase doc before building.
3. Once review passes, follow the `/build` workflow exactly:
   - Decompose into sub-components
   - Write tests before implementation for each sub-component
   - Run `./validate.sh` after each sub-component
4. Decide whether this enhancement needs a Playwright e2e test — **most do not**:
   - Read [`docs/guides/e2e-test-policy.md`](../../docs/guides/e2e-test-policy.md). Write a spec **only** if the changed behaviour falls into one of its six groups (auth session lifecycle, streaming into the DOM, file upload/download, navigation state across a page load, accessibility, smoke).
   - If it does not — which is the common case — the coverage belongs at the layer that owns the logic (`packages/application`, `packages/domain`, `packages/adapters`, or a component test). You have already written those in step 3. **Write no spec, and say so in the summary.**
   - If it does qualify: extend the existing spec for that capability rather than adding a file, and obey the policy's non-negotiable rules — no `test.skip()` on a self-probed condition, no `isVisible()` for control flow, no environment-variable gates.
   - **Do not run the e2e suite.** CI runs it — `.github/workflows/e2e.yml` fires on every pull request and push to `main` and `release/**`, sharded, against a full stack. A local run needs Postgres, Redis, MinIO and a built app, and only duplicates that. Run `/e2e` or `/e2e-cc-web` only if the user explicitly asks for a local run.
5. On completion:
   - Move phase doc to `implemented/<release line>/v[version]/`. The release line comes from
     the **Release Branching** section of `CLAUDE.md`, not from the version number: the
     `Next release line` value when the base branch is `main`, the current release branch's own
     name otherwise (see `docs/guides/versioning.md`)
   - Write implementation summary (include which e2e test covers the change)
   - Apply the version bump (PATCH when the base branch is a `release/*` branch)
   - Run `./validate.sh`
   - Commit all changes and push the branch
   - **Always open the pull request** via `mcp__github__create_pull_request`, against the base branch from step 0 (not necessarily `main`) — no need to ask first, and never stop at "pushed". The PR is what starts CI, including the e2e suite that was deliberately not run locally.
   - **Write the PR body into [`.github/pull_request_template.md`](../../.github/pull_request_template.md)** — read that file and fill its sections; do not invent a structure. The approved change summary is the source, **corrected to describe what was actually implemented rather than what was planned**:

     | Template section | Filled from |
     |---|---|
     | `## Summary` | The change summary's headline and **Goal**, as one paragraph in the user's terms |
     | `## Impact` → Features affected | The user-facing and admin areas the enhancement touches |
     | `## Impact` → Business rules changed | **Business rules changing**, each with its trigger and resulting behaviour |
     | `## UI Impact` | **UI / visible behaviour**, restated as what the user experiences |
     | `## Why this change is required` | The answer to clarifying question 1 — what becomes possible that isn't today, or what was going wrong |
     | `<details>` implementation block | Version bump, files created and modified, migrations generated with their `-- data-impact:` line, tests written and the e2e decision (spec extended with its policy group, or "no e2e — covered at `<layer>`"), known limitations |

   - **Call out every deviation** from the approved summary explicitly, in the implementation block's deviations line. "None" if there were none.
   - A section that does not apply gets a one-line reason, never a bare `N/A` and never a deleted heading.
   - Report the PR URL, and note that the e2e suite runs there rather than locally.
