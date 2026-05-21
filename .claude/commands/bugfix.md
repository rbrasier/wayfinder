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

### Step 5 — On completion

- Move bug-fix doc: `to-be-implemented/<name>.md` → `implemented/v[version]/<name>.md`
- Write an implementation summary: root cause, fix applied, regression test added
- Apply a PATCH version bump
- Update `VERSION` and root `package.json` `version`
- Run `./validate.sh` one final time
