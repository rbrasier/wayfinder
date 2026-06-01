# /enhance — Enhancement / Revision

Use this skill when the user wants to change or extend something already built.

---

## Required Clarifying Questions

Ask all of these via `AskUserQuestion` before proceeding:

1. What's changing, and why?
2. Which entities or use cases are affected?
3. Are DB changes needed?
4. Is this a MINOR or PATCH bump?

**After gathering answers:** Output a bulleted plan to the chat covering the likely changes — entities and use cases touched, files to modify, DB migrations needed, API or UI changes, and the version bump target. Do this as regular chat text — do NOT put it inside `AskUserQuestion`. Then use `AskUserQuestion` to ask: "Does this plan look right?" Wait for confirmation before starting the workflow.

---

## Workflow

1. Generate an updated phase doc in `docs/development/to-be-implemented/` describing
   what changes and why — do not start coding yet.
2. Run `/doc-review` on the new phase doc before building.
3. Once review passes, follow the `/build` workflow exactly:
   - Decompose into sub-components
   - Write tests before implementation for each sub-component
   - Run `./validate.sh` after each sub-component
4. Write at least one Playwright e2e test that exercises the changed or extended functionality end-to-end:
   - Place tests under `apps/web/e2e/` (or `apps/api/e2e/`) in a file named after the enhancement (e.g. `enhance-<slug>.spec.ts`)
   - Cover the primary user-facing behaviour introduced or modified by this enhancement
   - The test must pass against the updated code before moving on
5. On completion:
   - Move phase doc to `implemented/v[version]/`
   - Write implementation summary (include which e2e test covers the change)
   - Apply the version bump
   - Run `./validate.sh`
   - Commit all changes, push the branch, then open a pull request via `mcp__github__create_pull_request` so CI runs automatically. Include in the PR body: what changed, why, and which e2e test covers the new behaviour.
