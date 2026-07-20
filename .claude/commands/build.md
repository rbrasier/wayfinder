# /build — Build: New Phase or Feature

Use this skill when documentation review has passed and the user confirms,
or when the user explicitly asks to implement a specific phase or feature.

**Pre-flight:** Confirm the phase doc in `docs/development/to-be-implemented/`
exists and has passed `/doc-review`. Read the PRD, ADR(s), and phase doc in
full before writing a single line of code. Create the working branch
(`feature/<slug>`) from `main` — new features land on the next alpha, never
on a `release/alpha-N` branch (see **Release Branching** in `CLAUDE.md`).

---

## Workflow

### Step 1 — Decompose

Break the phase into sub-components of no more than 3–4 files each.
List them before starting so the user can see the plan.

### Step 2 — For each sub-component (strictly in order)

**A. Write tests first**
- Create `*.test.ts` before the implementation file
- Cover: happy path, error path (`DomainError`), key edge cases
- Use in-memory fakes for ports — never mock what you own
- Tests must read as plain English: setup → execute → verify
- Prefer a few duplicated setup lines over a shared abstraction that obscures intent

**B. Implement**
- Make the tests pass with the minimum code required
- Follow all architecture and code writing rules from `CLAUDE.md`
- Before calling any third-party API (Vercel AI SDK, LangGraph, Better Auth, Drizzle):
  verify the method signature in `node_modules/<package>/` source — do not trust training data

**C. Validate**
- Run `./validate.sh`
- Fix every failure before moving to the next sub-component
- Do not proceed until `validate.sh` exits 0

### Step 3 — Playwright e2e test

Once all sub-components pass validation, write at least one Playwright e2e test that exercises the completed feature end-to-end through the UI or API surface:
- Place tests under `apps/web/e2e/` in a file named after the phase (e.g. `phase-<slug>.spec.ts`)
- Cover the primary happy path and at least one error path visible to the user
- The test must pass before proceeding to Step 4

### Step 4 — On completion

- Move phase doc: `to-be-implemented/<name>.md` → `implemented/alpha-<major>/v[version]/<name>.md`
  where `alpha-<major>` is the current release line — `alpha-2` for `2.x.x`, `alpha-1` for `1.x.x` (see `docs/guides/versioning.md`)
- Write an implementation summary in `implemented/alpha-<major>/v[version]/` covering:
  what was built, files created/modified, migrations run, known limitations, e2e tests added
- Update `VERSION` file and root `package.json` `version` (they must match)
- Run `./validate.sh` one final time — fix all failures before declaring done
- State the version bump applied (MAJOR / MINOR / PATCH)
- Commit all changes, push the branch, then open a pull request via `mcp__github__create_pull_request` against `main` so CI runs automatically — new features never target a `release/alpha-N` branch (see **Release Branching** in `CLAUDE.md`). Include in the PR body: phase summary, files changed, version bump, and which e2e tests cover the new functionality.
