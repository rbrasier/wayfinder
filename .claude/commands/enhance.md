# /enhance — Enhancement / Revision

Use this skill when the user wants to change or extend something already built.

---

## Required Clarifying Questions

Ask before proceeding:

1. What's changing, and why?
2. Which entities or use cases are affected?
3. Are DB changes needed?
4. Is this a MINOR or PATCH bump?

---

## Workflow

1. Generate an updated phase doc in `docs/development/to-be-implemented/` describing
   what changes and why — do not start coding yet.
2. Run `/doc-review` on the new phase doc before building.
3. Once review passes, follow the `/build` workflow exactly:
   - Decompose into sub-components
   - Write tests before implementation for each sub-component
   - Run `./validate.sh` after each sub-component
4. On completion:
   - Move phase doc to `implemented/v[version]/`
   - Write implementation summary
   - Apply the version bump
   - Run `./validate.sh`
