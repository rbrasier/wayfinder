# /bugfix — Bug Fix

Use this skill when the user reports something broken or not working as expected.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What's the symptom?
2. How do you reproduce it?
3. Which page or feature is affected?
4. Severity: blocker / major / minor?

**After gathering answers:** Output a bulleted plan to the chat covering the suspected area of the codebase, files likely involved, and the planned diagnostic approach. Do this as regular chat text — do NOT put it inside `AskUserQuestion`. Then use `AskUserQuestion` to ask: "Does this plan look right?" Wait for confirmation before starting the workflow.

---

## Workflow

### Step 1 — Diagnose first, code second

Generate a bug-fix doc in `docs/development/to-be-implemented/` with:
- Root cause diagnosis (verified, not assumed)
- Reproduction steps
- Fix plan

Do not write implementation code until the diagnosis is confirmed.

### Step 2 — Write a failing test

Before fixing the bug, write a test that reproduces it and currently fails.
This test becomes the regression guard.

### Step 3 — Fix

Implement the minimal change that makes the failing test pass without
breaking existing tests. Do not refactor unrelated code in the same commit.

### Step 4 — Validate

Run `./validate.sh` and fix all failures.

### Step 5 — Playwright e2e test

Write at least one Playwright e2e test that exercises the fixed behaviour through the UI or API surface:
- Place tests under `apps/web/e2e/` (or `apps/api/e2e/`) in a file named after the bug (e.g. `fix-<slug>.spec.ts`)
- The test must fail on the unfixed code and pass after the fix — confirm this before moving on
- Cover the exact reproduction steps from the bug report, plus any related edge cases the fix touches

### Step 6 — On completion

- Move bug-fix doc: `to-be-implemented/<name>.md` → `implemented/v[version]/<name>.md`
- Write an implementation summary: root cause, fix applied, regression test added, e2e test added
- Apply a PATCH version bump
- Update `VERSION` and root `package.json` `version`
- Run `./validate.sh` one final time
- Commit all changes, push the branch, then open a pull request via `mcp__github__create_pull_request` so CI runs automatically. Include in the PR body: symptom, root cause, fix summary, and which e2e test covers it.
