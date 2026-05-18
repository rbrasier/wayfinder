# /build — Build: New Phase or Feature

Use this skill when documentation review has passed and the user confirms,
or when the user explicitly asks to implement a specific phase or feature.

**Pre-flight:** Confirm the phase doc in `docs/development/to-be-implemented/`
exists and has passed `/doc-review`. Read the PRD, ADR(s), and phase doc in
full before writing a single line of code.

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

### Step 3 — On completion

- Move phase doc: `to-be-implemented/<name>.md` → `implemented/v[version]/<name>.md`
- Write an implementation summary in `implemented/v[version]/` covering:
  what was built, files created/modified, migrations run, known limitations
- Update `VERSION` file and root `package.json` `version` (they must match)
- Run `./validate.sh` one final time — fix all failures before declaring done
- State the version bump applied (MAJOR / MINOR / PATCH)
